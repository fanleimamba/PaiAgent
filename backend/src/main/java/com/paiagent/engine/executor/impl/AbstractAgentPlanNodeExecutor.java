package com.paiagent.engine.executor.impl;

import com.paiagent.engine.executor.NodeExecutor;
import com.paiagent.engine.model.WorkflowNode;
import org.springframework.util.StringUtils;

import java.util.Map;

abstract class AbstractAgentPlanNodeExecutor implements NodeExecutor {

    protected String textValue(WorkflowNode node, Map<String, Object> input, String field, String fallbackField) {
        Object nodeValue = node.getData().get(field);
        if (StringUtils.hasText(asText(nodeValue))) {
            return asText(nodeValue);
        }
        Object inputValue = input.get(field);
        if (StringUtils.hasText(asText(inputValue))) {
            return asText(inputValue);
        }
        if (StringUtils.hasText(fallbackField)) {
            Object fallbackValue = input.get(fallbackField);
            if (StringUtils.hasText(asText(fallbackValue))) {
                return asText(fallbackValue);
            }
        }
        Object output = input.get("output");
        return StringUtils.hasText(asText(output)) ? asText(output) : null;
    }

    protected String stringData(WorkflowNode node, String field, String defaultValue) {
        String value = asText(node.getData().get(field));
        return StringUtils.hasText(value) ? value : defaultValue;
    }

    protected int intData(WorkflowNode node, String field, int defaultValue) {
        Object value = node.getData().get(field);
        if (value instanceof Number number) {
            return number.intValue();
        }
        String text = asText(value);
        return StringUtils.hasText(text) ? Integer.parseInt(text) : defaultValue;
    }

    protected double doubleData(WorkflowNode node, String field, double defaultValue) {
        Object value = node.getData().get(field);
        if (value instanceof Number number) {
            return number.doubleValue();
        }
        String text = asText(value);
        return StringUtils.hasText(text) ? Double.parseDouble(text) : defaultValue;
    }

    protected String asText(Object value) {
        if (value == null) {
            return null;
        }
        String text = String.valueOf(value).trim();
        return text.isEmpty() ? null : text;
    }
}
