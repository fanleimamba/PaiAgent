package com.paiagent.controller;

import com.alibaba.fastjson2.JSON;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.paiagent.common.Result;
import com.paiagent.dto.ExecutionEvent;
import com.paiagent.dto.ExecutionRequest;
import com.paiagent.dto.ExecutionResponse;
import com.paiagent.engine.EngineSelector;
import com.paiagent.engine.WorkflowExecutor;
import com.paiagent.entity.ExecutionRecord;
import com.paiagent.entity.Workflow;
import com.paiagent.mapper.ExecutionRecordMapper;
import com.paiagent.service.WorkflowService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;

@Slf4j
@Tag(name = "工作流执行接口")
@RestController
@RequestMapping("/api/workflows")
public class ExecutionController {
    
    @Autowired
    private WorkflowService workflowService;
    
    @Autowired
    private EngineSelector engineSelector;

    @Autowired
    private ExecutionRecordMapper executionRecordMapper;
    
    private final Map<String, SseEmitter> emitters = new ConcurrentHashMap<>();
    
    @Operation(summary = "执行工作流")
    @PostMapping("/{id}/execute")
    public Result<ExecutionResponse> executeWorkflow(@PathVariable Long id, @Valid @RequestBody ExecutionRequest request) {
        Workflow workflow = workflowService.getById(id);
        if (workflow == null) {
            return Result.error("工作流不存在");
        }
        
        try {
            // 使用引擎选择器选择合适的执行引擎
            WorkflowExecutor executor = engineSelector.selectEngine(workflow);
            ExecutionResponse response = executor.execute(workflow, request.getInputData());
            return Result.success(response);
        } catch (Exception e) {
            return Result.error("工作流执行失败: " + e.getMessage());
        }
    }

    @Operation(summary = "获取工作流最近一次执行记录")
    @GetMapping("/{id}/executions/latest")
    public Result<ExecutionResponse> getLatestExecution(@PathVariable Long id) {
        Workflow workflow = workflowService.getById(id);
        if (workflow == null) {
            return Result.error("工作流不存在");
        }

        LambdaQueryWrapper<ExecutionRecord> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ExecutionRecord::getFlowId, id)
               .orderByDesc(ExecutionRecord::getExecutedAt)
               .orderByDesc(ExecutionRecord::getId)
               .last("LIMIT 1");

        ExecutionRecord record = executionRecordMapper.selectOne(wrapper);
        if (record == null) {
            return Result.success(null);
        }

        ExecutionResponse response = new ExecutionResponse();
        response.setExecutionId(record.getId());
        response.setStatus(record.getStatus());
        response.setInputData(record.getInputData());
        response.setOutputData(record.getOutputData());
        response.setDuration(record.getDuration());
        response.setErrorMessage(record.getErrorMessage());
        response.setNodeResults(parseNodeResults(record.getNodeResults()));
        return Result.success(response);
    }
    
    @Operation(summary = "实时执行工作流(SSE)")
    @GetMapping(value = "/{id}/execute/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter executeWorkflowStream(@PathVariable Long id, @RequestParam String inputData) {
        SseEmitter emitter = new SseEmitter(300000L);
        String emitterId = id + "_" + System.currentTimeMillis();
        emitters.put(emitterId, emitter);
        
        emitter.onCompletion(() -> emitters.remove(emitterId));
        emitter.onTimeout(() -> emitters.remove(emitterId));
        emitter.onError((e) -> emitters.remove(emitterId));
        
        Consumer<ExecutionEvent> eventCallback = event -> {
            try {
                emitter.send(SseEmitter.event()
                        .name(event.getEventType())
                        .data(event));
            } catch (IOException e) {
                log.error("发送 SSE 事件失败", e);
                emitters.remove(emitterId);
            }
        };
        
        new Thread(() -> {
            try {
                Workflow workflow = workflowService.getById(id);
                if (workflow == null) {
                    emitter.send(SseEmitter.event()
                            .name("ERROR")
                            .data(ExecutionEvent.workflowComplete("FAILED", "工作流不存在", 0)));
                    emitter.complete();
                    return;
                }
                
                // 使用引擎选择器选择合适的执行引擎
                WorkflowExecutor executor = engineSelector.selectEngine(workflow);
                executor.executeWithCallback(workflow, inputData, eventCallback);
                emitter.complete();
            } catch (Exception e) {
                log.error("工作流执行失败", e);
                try {
                    emitter.send(SseEmitter.event()
                            .name("ERROR")
                            .data(ExecutionEvent.workflowComplete("FAILED", e.getMessage(), 0)));
                } catch (IOException ex) {
                    log.error("发送错误事件失败", ex);
                }
                emitter.complete();
            }
        }).start();
        
        return emitter;
    }

    private List<ExecutionResponse.NodeResult> parseNodeResults(String nodeResults) {
        if (nodeResults == null || nodeResults.isBlank()) {
            return Collections.emptyList();
        }

        try {
            return JSON.parseArray(nodeResults, ExecutionResponse.NodeResult.class);
        } catch (Exception e) {
            log.warn("解析执行节点结果失败", e);
            return Collections.emptyList();
        }
    }
}
