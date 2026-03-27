package com.paiagent.engine.llm;

import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.model.function.FunctionCallback;
import org.springframework.ai.openai.OpenAiChatModel;
import org.springframework.ai.openai.OpenAiChatOptions;
import org.springframework.ai.openai.api.OpenAiApi;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Locale;

/**
 * ChatClient动态工厂
 * 根据节点配置在运行时创建不同类型的ChatClient实例
 */
@Slf4j
@Component
public class ChatClientFactory {

    private static final String CHAT_COMPLETIONS_SUFFIX = "/v1/chat/completions";

    private static final String V1_SUFFIX = "/v1";

    /**
     * 根据节点类型和配置创建ChatClient
     *
     * @param nodeType    节点类型 (openai/deepseek/qwen)
     * @param apiUrl      API端点URL
     * @param apiKey      API密钥
     * @param model       模型名称
     * @param temperature 温度参数
     * @return ChatClient实例
     */
    public ChatClient createClient(String nodeType, String apiUrl, String apiKey,
                                   String model, Double temperature) {
        return createClientWithFunctions(nodeType, apiUrl, apiKey, model, temperature, List.of());
    }

    /**
     * 创建带 Function Calling 支持的 ChatClient
     *
     * @param nodeType    节点类型 (openai/deepseek/qwen)
     * @param apiUrl      API端点URL
     * @param apiKey      API密钥
     * @param model       模型名称
     * @param temperature 温度参数
     * @param functions   函数回调列表
     * @return ChatClient实例
     */
    public ChatClient createClientWithFunctions(String nodeType, String apiUrl, String apiKey,
                                                 String model, Double temperature,
                                                 List<FunctionCallback> functions) {
        log.info("创建ChatClient - 类型: {}, URL: {}, 模型: {}, 温度: {}, 函数数量: {}",
                nodeType, apiUrl, model, temperature, functions.size());

        ChatModel chatModel = switch (nodeType) {
            case "openai", "deepseek", "qwen" -> createOpenAICompatibleModel(apiUrl, apiKey, model, temperature);
            default -> throw new IllegalArgumentException("不支持的节点类型: " + nodeType);
        };

        ChatClient.Builder builder = ChatClient.builder(chatModel);

        // 注册函数 - 直接传入 FunctionCallback 实例
        if (functions != null && !functions.isEmpty()) {
            builder.defaultFunctions(functions.toArray(new FunctionCallback[0]));
            for (FunctionCallback function : functions) {
                log.debug("注册函数: {}", function.getName());
            }
        }

        return builder.build();
    }

    /**
     * 创建OpenAI兼容的ChatModel
     * 支持OpenAI、DeepSeek和通义千问（通过OpenAI兼容接口）
     */
    private ChatModel createOpenAICompatibleModel(String apiUrl, String apiKey,
                                                   String model, Double temperature) {
        String normalizedApiUrl = normalizeBaseUrl(apiUrl);
        if (!normalizedApiUrl.equals(apiUrl)) {
            log.warn("检测到 OpenAI 兼容接口地址包含路径后缀，已自动归一化: {} -> {}", apiUrl, normalizedApiUrl);
        }

        // 使用构造函数创建OpenAiApi（支持自定义baseUrl）
        OpenAiApi openAiApi = new OpenAiApi(normalizedApiUrl, apiKey);

        // 创建ChatModel并配置选项
        OpenAiChatOptions options = OpenAiChatOptions.builder()
                .model(model)
                .temperature(temperature)
                .build();

        return new OpenAiChatModel(openAiApi, options);
    }

    /**
     * Spring AI 的 OpenAiApi 会自行拼接 /v1/chat/completions，
     * 这里统一将用户输入的 URL 归一化为服务根地址，兼容误填完整接口地址的情况。
     */
    private String normalizeBaseUrl(String apiUrl) {
        String normalized = stripTrailingSlash(apiUrl == null ? "" : apiUrl.trim());
        normalized = stripSuffixIgnoreCase(normalized, CHAT_COMPLETIONS_SUFFIX);
        normalized = stripSuffixIgnoreCase(normalized, V1_SUFFIX);
        return stripTrailingSlash(normalized);
    }

    private String stripSuffixIgnoreCase(String value, String suffix) {
        String lowerValue = value.toLowerCase(Locale.ROOT);
        if (!lowerValue.endsWith(suffix)) {
            return value;
        }
        return value.substring(0, value.length() - suffix.length());
    }

    private String stripTrailingSlash(String value) {
        int end = value.length();
        while (end > 0 && value.charAt(end - 1) == '/') {
            end--;
        }
        return value.substring(0, end);
    }
}
