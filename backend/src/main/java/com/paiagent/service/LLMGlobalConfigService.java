package com.paiagent.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.paiagent.entity.LLMGlobalConfig;
import com.paiagent.mapper.LLMGlobalConfigMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * 全局 LLM 配置服务
 */
@Service
public class LLMGlobalConfigService extends ServiceImpl<LLMGlobalConfigMapper, LLMGlobalConfig> {

    /**
     * 获取某提供商的所有配置
     */
    public List<LLMGlobalConfig> listByProvider(String provider) {
        LambdaQueryWrapper<LLMGlobalConfig> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(LLMGlobalConfig::getProvider, provider)
               .orderByDesc(LLMGlobalConfig::getIsDefault)
               .orderByDesc(LLMGlobalConfig::getUpdatedAt);
        return this.list(wrapper);
    }

    /**
     * 获取某提供商的默认配置
     */
    public LLMGlobalConfig getDefaultConfig(String provider) {
        LambdaQueryWrapper<LLMGlobalConfig> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(LLMGlobalConfig::getProvider, provider)
               .eq(LLMGlobalConfig::getIsDefault, 1);
        return this.getOne(wrapper);
    }

    /**
     * 设置默认配置
     * 先清除该提供商的其他默认配置，再设置指定配置为默认
     */
    @Transactional
    public void setDefaultConfig(Long id) {
        LLMGlobalConfig config = this.getById(id);
        if (config == null) {
            throw new RuntimeException("配置不存在");
        }

        // 清除该提供商的其他默认配置
        LambdaUpdateWrapper<LLMGlobalConfig> clearWrapper = new LambdaUpdateWrapper<>();
        clearWrapper.eq(LLMGlobalConfig::getProvider, config.getProvider())
                    .set(LLMGlobalConfig::getIsDefault, 0);
        this.update(clearWrapper);

        // 设置指定配置为默认
        config.setIsDefault(1);
        this.updateById(config);
    }

    /**
     * 保存配置（新增或更新）
     * 如果是第一个配置，自动设置为默认
     */
    @Transactional
    public LLMGlobalConfig saveConfig(LLMGlobalConfig config) {
        // 检查是否是该提供商的第一个配置
        long count = this.countByProvider(config.getProvider());

        if (config.getId() == null) {
            // 新增配置
            if (count == 0) {
                config.setIsDefault(1);
            } else if (config.getIsDefault() == null) {
                config.setIsDefault(0);
            }
            this.save(config);
        } else {
            // 更新配置
            if (config.getIsDefault() != null && config.getIsDefault() == 1) {
                // 如果要设置为默认，先清除其他默认配置
                LambdaUpdateWrapper<LLMGlobalConfig> clearWrapper = new LambdaUpdateWrapper<>();
                clearWrapper.eq(LLMGlobalConfig::getProvider, config.getProvider())
                           .ne(LLMGlobalConfig::getId, config.getId())
                           .set(LLMGlobalConfig::getIsDefault, 0);
                this.update(clearWrapper);
            }
            this.updateById(config);
        }

        return config;
    }

    /**
     * 删除配置
     * 如果删除的是默认配置，自动将下一个配置设为默认
     */
    @Transactional
    public void deleteConfig(Long id) {
        LLMGlobalConfig config = this.getById(id);
        if (config == null) {
            return;
        }

        String provider = config.getProvider();
        boolean wasDefault = config.getIsDefault() == 1;

        this.removeById(id);

        // 如果删除的是默认配置，将下一个配置设为默认
        if (wasDefault) {
            List<LLMGlobalConfig> remaining = this.listByProvider(provider);
            if (!remaining.isEmpty()) {
                LLMGlobalConfig newDefault = remaining.get(0);
                newDefault.setIsDefault(1);
                this.updateById(newDefault);
            }
        }
    }

    /**
     * 统计某提供商的配置数量
     */
    private long countByProvider(String provider) {
        LambdaQueryWrapper<LLMGlobalConfig> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(LLMGlobalConfig::getProvider, provider);
        return this.count(wrapper);
    }
}
