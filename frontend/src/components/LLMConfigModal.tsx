import React, { useEffect, useState } from 'react';
import {
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Button,
  Table,
  Space,
  message,
  Popconfirm
} from 'antd';
import { SettingOutlined, PlusOutlined, EditOutlined, DeleteOutlined, StarOutlined, StarFilled } from '@ant-design/icons';
import { useLLMConfigStore } from '../store/llmConfigStore';
import { LLMGlobalConfig, LLMConfigRequest } from '../api/llmConfig';

const PROVIDERS = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'qwen', label: '通义千问' }
];

interface LLMConfigModalProps {
  visible?: boolean;
  onClose?: () => void;
}

const LLMConfigModal: React.FC<LLMConfigModalProps> = ({ visible, onClose }) => {
  const [modalVisible, setModalVisible] = useState(visible || false);
  const [formVisible, setFormVisible] = useState(false);
  const [editingConfig, setEditingConfig] = useState<LLMGlobalConfig | null>(null);
  const [form] = Form.useForm();

  const {
    configs,
    loading,
    error,
    fetchAllConfigs,
    saveConfig,
    deleteConfig,
    setDefaultConfig,
    clearError
  } = useLLMConfigStore();

  useEffect(() => {
    if (modalVisible) {
      fetchAllConfigs();
    }
  }, [modalVisible]);

  useEffect(() => {
    if (visible !== undefined) {
      setModalVisible(visible);
    }
  }, [visible]);

  useEffect(() => {
    if (error) {
      message.error(error);
      clearError();
    }
  }, [error]);

  const handleOpenModal = () => {
    setModalVisible(true);
  };

  const handleCloseModal = () => {
    setModalVisible(false);
    setFormVisible(false);
    setEditingConfig(null);
    form.resetFields();
    onClose?.();
  };

  const handleOpenForm = (config?: LLMGlobalConfig) => {
    setEditingConfig(config || null);
    setFormVisible(true);
    if (config) {
      form.setFieldsValue({
        provider: config.provider,
        configName: config.configName,
        apiUrl: config.apiUrl,
        apiKey: config.apiKey,
        model: config.model,
        temperature: config.temperature
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ temperature: 0.7 });
    }
  };

  const handleCloseForm = () => {
    setFormVisible(false);
    setEditingConfig(null);
    form.resetFields();
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const request: LLMConfigRequest = {
        id: editingConfig?.id,
        provider: values.provider,
        configName: values.configName,
        apiUrl: values.apiUrl,
        apiKey: values.apiKey,
        model: values.model,
        temperature: values.temperature
      };

      const result = await saveConfig(request);
      if (result) {
        message.success(editingConfig ? '配置已更新' : '配置已创建');
        handleCloseForm();
      }
    } catch (error) {
      console.error('Form validation failed:', error);
    }
  };

  const handleDelete = async (id: number) => {
    const success = await deleteConfig(id);
    if (success) {
      message.success('配置已删除');
    }
  };

  const handleSetDefault = async (id: number) => {
    const success = await setDefaultConfig(id);
    if (success) {
      message.success('已设置为默认配置');
    }
  };

  const columns = [
    {
      title: '提供商',
      dataIndex: 'provider',
      key: 'provider',
      width: 100,
      render: (provider: string) => {
        const p = PROVIDERS.find(item => item.value === provider);
        return p?.label || provider;
      }
    },
    {
      title: '配置名称',
      dataIndex: 'configName',
      key: 'configName',
      width: 150
    },
    {
      title: 'API 地址',
      dataIndex: 'apiUrl',
      key: 'apiUrl',
      ellipsis: true,
      width: 200
    },
    {
      title: '模型',
      dataIndex: 'model',
      key: 'model',
      width: 120
    },
    {
      title: '温度',
      dataIndex: 'temperature',
      key: 'temperature',
      width: 80
    },
    {
      title: '默认',
      dataIndex: 'isDefault',
      key: 'isDefault',
      width: 60,
      render: (isDefault: number) => isDefault === 1 ? <StarFilled style={{ color: '#faad14' }} /> : null
    },
    {
      title: '操作',
      key: 'action',
      width: 150,
      render: (_: any, record: LLMGlobalConfig) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleOpenForm(record)}
          >
            编辑
          </Button>
          {record.isDefault !== 1 && (
            <Button
              type="link"
              size="small"
              icon={<StarOutlined />}
              onClick={() => handleSetDefault(record.id)}
            >
              设为默认
            </Button>
          )}
          <Popconfirm
            title="确定要删除此配置吗？"
            onConfirm={() => handleDelete(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <>
      {!visible && (
        <Button
          type="text"
          icon={<SettingOutlined />}
          onClick={handleOpenModal}
          title="LLM 配置管理"
        />
      )}

      <Modal
        title="全局 LLM 配置管理"
        open={modalVisible}
        onCancel={handleCloseModal}
        footer={null}
        width={900}
      >
        <div className="mb-4">
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => handleOpenForm()}
          >
            新增配置
          </Button>
        </div>

        <Table
          columns={columns}
          dataSource={configs}
          rowKey="id"
          loading={loading}
          pagination={false}
          size="small"
        />

        <Modal
          title={editingConfig ? '编辑配置' : '新增配置'}
          open={formVisible}
          onCancel={handleCloseForm}
          onOk={handleSubmit}
          confirmLoading={loading}
          okText="保存"
          cancelText="取消"
        >
          <Form
            form={form}
            layout="vertical"
            autoComplete="off"
          >
            <Form.Item
              name="provider"
              label="提供商"
              rules={[{ required: true, message: '请选择提供商' }]}
            >
              <Select
                placeholder="选择提供商"
                options={PROVIDERS}
                disabled={!!editingConfig}
              />
            </Form.Item>

            <Form.Item
              name="configName"
              label="配置名称"
              rules={[{ required: true, message: '请输入配置名称' }]}
            >
              <Input placeholder="例如: 生产环境、测试环境" />
            </Form.Item>

            <Form.Item
              name="apiUrl"
              label="API 地址"
              rules={[{ required: true, message: '请输入 API 地址' }]}
            >
              <Input placeholder="例如: https://api.openai.com/v1" />
            </Form.Item>

            <Form.Item
              name="apiKey"
              label="API 密钥"
              rules={[{ required: true, message: '请输入 API 密钥' }]}
            >
              <Input.Password placeholder="输入 API 密钥" />
            </Form.Item>

            <Form.Item
              name="model"
              label="默认模型"
              rules={[{ required: true, message: '请输入默认模型' }]}
            >
              <Input placeholder="例如: gpt-3.5-turbo, deepseek-chat" />
            </Form.Item>

            <Form.Item
              name="temperature"
              label="温度"
              tooltip="控制输出的随机性，值越小越确定，值越大越随机"
            >
              <InputNumber
                min={0}
                max={2}
                step={0.1}
                style={{ width: '100%' }}
              />
            </Form.Item>
          </Form>
        </Modal>
      </Modal>
    </>
  );
};

export default LLMConfigModal;
