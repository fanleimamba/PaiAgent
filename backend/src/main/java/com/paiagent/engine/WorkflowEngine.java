package com.paiagent.engine;

import com.alibaba.fastjson2.JSON;
import com.paiagent.dto.ExecutionEvent;
import com.paiagent.dto.ExecutionResponse;
import com.paiagent.engine.dag.DAGParser;
import com.paiagent.engine.executor.NodeExecutor;
import com.paiagent.engine.executor.NodeExecutorFactory;
import com.paiagent.engine.model.WorkflowConfig;
import com.paiagent.engine.model.WorkflowEdge;
import com.paiagent.engine.model.WorkflowNode;
import com.paiagent.entity.ExecutionRecord;
import com.paiagent.entity.Workflow;
import com.paiagent.mapper.ExecutionRecordMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.function.Consumer;

@Slf4j
@Service
public class WorkflowEngine implements WorkflowExecutor {
    
    @Autowired
    private DAGParser dagParser;
    
    @Autowired
    private NodeExecutorFactory executorFactory;
    
    @Autowired
    private ExecutionRecordMapper executionRecordMapper;
    
    @Override
    public ExecutionResponse execute(Workflow workflow, String inputData) {
        return executeWithCallback(workflow, inputData, null);
    }
    
    @Override
    public ExecutionResponse executeWithCallback(Workflow workflow, String inputData, Consumer<ExecutionEvent> eventCallback) {
        long startTime = System.currentTimeMillis();
        
        WorkflowConfig config = JSON.parseObject(workflow.getFlowData(), WorkflowConfig.class);
        List<WorkflowNode> sortedNodes = dagParser.parse(config);
        List<WorkflowEdge> edges = config.getEdges() != null ? config.getEdges() : new ArrayList<>();
        
        // 构建边的索引
        Map<String, List<WorkflowEdge>> edgesBySource = new HashMap<>();
        Map<String, List<WorkflowEdge>> edgesByTarget = new HashMap<>();
        for (WorkflowEdge edge : edges) {
            edgesBySource.computeIfAbsent(edge.getSource(), k -> new ArrayList<>()).add(edge);
            edgesByTarget.computeIfAbsent(edge.getTarget(), k -> new ArrayList<>()).add(edge);
        }
        
        List<ExecutionResponse.NodeResult> nodeResults = new ArrayList<>();
        Map<String, Map<String, Object>> nodeOutputs = new HashMap<>();
        Set<String> skippedNodes = new HashSet<>();
        
        Map<String, Object> currentInput = new HashMap<>();
        currentInput.put("input", inputData);
        
        String status = "SUCCESS";
        String errorMessage = null;
        String outputData = null;
        
        ExecutionRecord record = new ExecutionRecord();
        
        try {
            if (eventCallback != null) {
                eventCallback.accept(ExecutionEvent.workflowStart(null));
            }
            
            for (WorkflowNode node : sortedNodes) {
                // 跳过条件分支未选中的节点
                if (skippedNodes.contains(node.getId())) {
                    log.info("跳过节点 [{}]（条件分支未选中）", node.getId());
                    continue;
                }
                
                // 解析当前节点的输入
                Map<String, Object> nodeInput = resolveNodeInput(node, nodeOutputs, edgesByTarget, currentInput);
                
                long nodeStartTime = System.currentTimeMillis();
                
                if (eventCallback != null) {
                    eventCallback.accept(ExecutionEvent.nodeStart(node.getId(), node.getType()));
                }
                
                ExecutionResponse.NodeResult nodeResult = new ExecutionResponse.NodeResult();
                nodeResult.setNodeId(node.getId());
                nodeResult.setNodeName(node.getType());
                nodeResult.setInput(JSON.toJSONString(nodeInput));
                
                try {
                    NodeExecutor executor = executorFactory.getExecutor(node.getType());
                    Map<String, Object> output = executor.execute(node, nodeInput, eventCallback);
                    
                    nodeOutputs.put(node.getId(), output);
                    
                    nodeResult.setStatus("SUCCESS");
                    nodeResult.setOutput(JSON.toJSONString(output));
                    
                    long nodeEndTime = System.currentTimeMillis();
                    int nodeDuration = (int) (nodeEndTime - nodeStartTime);
                    nodeResult.setDuration(nodeDuration);
                    
                    if (eventCallback != null) {
                        Map<String, Object> eventData = new HashMap<>();
                        eventData.put("input", nodeInput);
                        eventData.put("output", output);
                        eventData.put("duration", nodeDuration);
                        eventCallback.accept(ExecutionEvent.nodeSuccess(node.getId(), node.getType(), eventData, nodeDuration));
                    }
                    
                    currentInput = output;
                    
                    // 条件分支路由
                    if ("condition".equals(node.getType())) {
                        String selectedBranch = (String) output.get("__selectedBranch__");
                        markSkippedNodes(node.getId(), selectedBranch, edgesBySource, edgesByTarget, skippedNodes);
                    }
                    
                } catch (Exception e) {
                    log.error("节点执行失败: {}", node.getId(), e);
                    nodeResult.setStatus("FAILED");
                    nodeResult.setError(e.getMessage());
                    status = "FAILED";
                    errorMessage = "节点 " + node.getId() + " 执行失败: " + e.getMessage();
                    
                    if (eventCallback != null) {
                        eventCallback.accept(ExecutionEvent.nodeError(node.getId(), node.getType(), e.getMessage()));
                    }
                    
                    throw e;
                } finally {
                    long nodeEndTime = System.currentTimeMillis();
                    nodeResult.setDuration((int) (nodeEndTime - nodeStartTime));
                    nodeResults.add(nodeResult);
                }
            }
            
            outputData = JSON.toJSONString(currentInput);
            
        } catch (Exception e) {
            status = "FAILED";
            if (errorMessage == null) {
                errorMessage = e.getMessage();
            }
        }
        
        long endTime = System.currentTimeMillis();
        int duration = (int) (endTime - startTime);
        
        if (eventCallback != null) {
            eventCallback.accept(ExecutionEvent.workflowComplete(status, currentInput, duration));
        }
        
        record.setFlowId(workflow.getId());
        Map<String, Object> inputDataMap = new HashMap<>();
        inputDataMap.put("input", inputData);
        String inputDataJson = JSON.toJSONString(inputDataMap);
        log.info("保存执行记录 - inputData: {}", inputDataJson);
        log.info("保存执行记录 - outputData: {}", outputData);
        record.setInputData(inputDataJson);
        record.setOutputData(outputData);
        record.setStatus(status);
        record.setNodeResults(JSON.toJSONString(nodeResults));
        record.setErrorMessage(errorMessage);
        record.setDuration(duration);
        executionRecordMapper.insert(record);
        
        ExecutionResponse response = new ExecutionResponse();
        response.setExecutionId(record.getId());
        response.setStatus(status);
        response.setInputData(inputDataJson);
        response.setNodeResults(nodeResults);
        response.setOutputData(outputData);
        response.setDuration(duration);
        
        return response;
    }
    
    @Override
    public String getEngineType() {
        return "dag";
    }
    
    /**
     * 解析节点输入：如果存在已执行的前驱节点输出，使用前驱节点输出作为输入
     */
    private Map<String, Object> resolveNodeInput(WorkflowNode node,
                                                   Map<String, Map<String, Object>> nodeOutputs,
                                                   Map<String, List<WorkflowEdge>> edgesByTarget,
                                                   Map<String, Object> fallbackInput) {
        List<WorkflowEdge> incomingEdges = edgesByTarget.get(node.getId());
        if (incomingEdges == null || incomingEdges.isEmpty()) {
            return fallbackInput;
        }
        Map<String, Object> resolved = null;
        for (WorkflowEdge edge : incomingEdges) {
            Map<String, Object> sourceOutput = nodeOutputs.get(edge.getSource());
            if (sourceOutput != null) {
                resolved = sourceOutput;
            }
        }
        return resolved != null ? resolved : fallbackInput;
    }
    
    /**
     * 标记条件分支中未选中路径的所有下游节点为跳过状态
     */
    private void markSkippedNodes(String conditionNodeId,
                                   String selectedBranch,
                                   Map<String, List<WorkflowEdge>> edgesBySource,
                                   Map<String, List<WorkflowEdge>> edgesByTarget,
                                   Set<String> skippedNodes) {
        List<WorkflowEdge> outEdges = edgesBySource.get(conditionNodeId);
        if (outEdges == null || outEdges.isEmpty()) {
            return;
        }
        
        // 判断出边是否使用了 sourceHandle（分支标识）
        boolean hasHandles = outEdges.stream().anyMatch(e -> e.getSourceHandle() != null);
        if (!hasHandles) {
            return;
        }
        
        // 收集活跃和非活跃分支的直接目标
        Set<String> activeTargets = new HashSet<>();
        Set<String> inactiveTargets = new HashSet<>();
        
        for (WorkflowEdge edge : outEdges) {
            String handle = edge.getSourceHandle();
            if (handle != null && handle.equals(selectedBranch)) {
                activeTargets.add(edge.getTarget());
            } else if (handle == null && "default".equals(selectedBranch)) {
                activeTargets.add(edge.getTarget());
            } else {
                inactiveTargets.add(edge.getTarget());
            }
        }
        
        // 递归标记非活跃分支下游节点
        for (String target : inactiveTargets) {
            if (!activeTargets.contains(target)) {
                markDownstreamSkipped(target, skippedNodes, edgesBySource, edgesByTarget);
            }
        }
    }
    
    /**
     * 递归标记下游节点为跳过。仅当节点所有入边都来自已跳过节点时才标记。
     */
    private void markDownstreamSkipped(String nodeId,
                                        Set<String> skippedNodes,
                                        Map<String, List<WorkflowEdge>> edgesBySource,
                                        Map<String, List<WorkflowEdge>> edgesByTarget) {
        if (skippedNodes.contains(nodeId)) {
            return;
        }
        
        // 检查是否所有入边的源节点都已被跳过（或尚无输出）
        List<WorkflowEdge> incomingEdges = edgesByTarget.get(nodeId);
        if (incomingEdges != null && incomingEdges.size() > 1) {
            for (WorkflowEdge edge : incomingEdges) {
                if (!skippedNodes.contains(edge.getSource())) {
                    // 有活跃路径可达此节点，不跳过
                    return;
                }
            }
        }
        
        skippedNodes.add(nodeId);
        log.info("标记节点 [{}] 为跳过（条件分支未选中路径）", nodeId);
        
        // 递归标记下游
        List<WorkflowEdge> outEdges = edgesBySource.get(nodeId);
        if (outEdges != null) {
            for (WorkflowEdge edge : outEdges) {
                markDownstreamSkipped(edge.getTarget(), skippedNodes, edgesBySource, edgesByTarget);
            }
        }
    }
}
