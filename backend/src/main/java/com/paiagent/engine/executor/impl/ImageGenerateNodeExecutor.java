package com.paiagent.engine.executor.impl;

import com.paiagent.engine.model.WorkflowNode;
import com.paiagent.service.AgentPlanConfigResolver;
import com.paiagent.service.MinioService;
import com.paiagent.service.ResolvedAgentPlanConfig;
import com.paiagent.service.VolcengineAgentPlanClient;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Slf4j
@Component
public class ImageGenerateNodeExecutor extends AbstractAgentPlanNodeExecutor {

    private final AgentPlanConfigResolver configResolver;
    private final VolcengineAgentPlanClient agentPlanClient;
    private final MinioService minioService;

    public ImageGenerateNodeExecutor(AgentPlanConfigResolver configResolver,
                                     VolcengineAgentPlanClient agentPlanClient,
                                     MinioService minioService) {
        this.configResolver = configResolver;
        this.agentPlanClient = agentPlanClient;
        this.minioService = minioService;
    }

    @Override
    @SuppressWarnings("unchecked")
    public Map<String, Object> execute(WorkflowNode node, Map<String, Object> input) throws Exception {
        String prompt = configuredTextInput(node, input, "prompt");
        if (prompt == null) {
            prompt = textValue(node, input, "prompt", "input");
        }
        if (prompt == null) {
            throw new IllegalArgumentException("图片生成节点缺少 prompt");
        }

        ResolvedAgentPlanConfig config = configResolver.resolve(node, "image");
        configResolver.validateApiConfig(config, "图片生成");

        Map<String, Object> result = agentPlanClient.generateImage(
                config,
                prompt,
                stringData(node, "referenceImageUrl", null),
                stringData(node, "size", "2K"),
                intData(node, "count", 1),
                stringData(node, "negativePrompt", null),
                stringData(node, "style", null)
        );

        List<String> sourceUrls = (List<String>) result.getOrDefault("imageUrls", List.of());
        List<String> persistedUrls = new ArrayList<>();
        for (String sourceUrl : sourceUrls) {
            persistedUrls.add(persistMedia(sourceUrl, "images/generated-" + System.currentTimeMillis() + ".png", "image/png"));
        }

        Map<String, Object> output = new LinkedHashMap<>();
        output.put("imageUrl", persistedUrls.isEmpty() ? null : persistedUrls.get(0));
        output.put("imageUrls", persistedUrls);
        output.put("prompt", prompt);
        output.put("model", config.model());
        output.put("metadata", result.get("metadata"));
        output.put("output", persistedUrls.isEmpty() ? null : persistedUrls.get(0));
        applyOutputParams(node, output);
        return output;
    }

    private String persistMedia(String sourceUrl, String objectName, String contentType) {
        if (!StringUtils.hasText(sourceUrl)) {
            return sourceUrl;
        }
        try {
            return minioService.uploadFromUrl(sourceUrl, objectName, contentType);
        } catch (Exception e) {
            log.warn("图片转存 MinIO 失败，保留原始 URL: {}", e.getMessage());
            return sourceUrl;
        }
    }

    @Override
    public String getSupportedNodeType() {
        return "image_generate";
    }
}
