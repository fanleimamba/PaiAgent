package com.paiagent.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.paiagent.entity.LLMGlobalConfig;
import org.apache.ibatis.annotations.Mapper;

/**
 * 全局 LLM 配置 Mapper 接口
 */
@Mapper
public interface LLMGlobalConfigMapper extends BaseMapper<LLMGlobalConfig> {
}
