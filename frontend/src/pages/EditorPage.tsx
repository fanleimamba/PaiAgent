import { useState, useEffect, useRef, useCallback } from 'react';
import { Button, Input, Form, message, Checkbox, Select, Modal, List } from 'antd';
import { SaveOutlined, FolderOpenOutlined, BugOutlined, LogoutOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { Edge, MarkerType, Node } from '@xyflow/react';
import NodePanel from '../components/NodePanel';
import FlowCanvas from '../components/FlowCanvas';
import DebugDrawer from '../components/DebugDrawer';
import SkillSelector from '../components/SkillSelector';
import LLMConfigModal from '../components/LLMConfigModal';
import { logout } from '../api/auth';
import { useWorkflowStore } from '../store/workflowStore';
import { useAuthStore } from '../store/authStore';
import { useLLMConfigStore } from '../store/llmConfigStore';
import { createWorkflow, updateWorkflow, executeWorkflow, getWorkflows, getWorkflow, Workflow } from '../api/workflow';
import { getRefreshToken } from '../utils/auth';
import {
  getProviderFromNodeType,
  getProviderLabel,
  getSupportedProviderOptions,
  isLlmNodeType,
  normalizeProviderKey,
} from '../utils/provider';
import { createDefaultWorkflowNodes, normalizeWorkflowNodes, serializeWorkflowNodes } from '../utils/workflowNode';
import { useNavigate, useParams } from 'react-router-dom';

interface OutputParam {
  name: string;
  type: 'input' | 'reference';
  value: string;
  referenceNode?: string;
}

interface LlmInputParam {
  name: string;
  type: 'input' | 'reference';
  value: string;
  referenceNode?: string;
}

interface LlmOutputParam {
  name: string;
  type: string;
  description?: string;
}

interface TtsInputParam {
  name: string;
  type: 'input' | 'reference';
  value: string;
  referenceNode?: string;
}

interface TtsOutputParam {
  name: string;
  value: string;
}

interface WorkflowCanvasData {
  nodes?: Node[];
  edges?: Edge[];
}

/**
 * 工作流编辑器页面
 */
const EditorPage = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { username, clearAuth } = useAuthStore();
  const { nodes, edges, currentWorkflowId, setCurrentWorkflowId, selectedNode, setNodes, setEdges } = useWorkflowStore();
  const [workflowName, setWorkflowName] = useState('未命名工作流');
  const [engineType, setEngineType] = useState('dag');
  const [saving, setSaving] = useState(false);
  const [debugDrawerOpen, setDebugDrawerOpen] = useState(false);
  const [outputParams, setOutputParams] = useState<OutputParam[]>([]);
  const [responseContent, setResponseContent] = useState('');
  const [loadModalOpen, setLoadModalOpen] = useState(false);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loadingWorkflows, setLoadingWorkflows] = useState(false);
  const hasLoadedRef = useRef<number | null>(null);
  
  // LLM 节点配置状态
  const [llmConfig, setLlmConfig] = useState({
    provider: '',
    configId: undefined as number | undefined,
    apiUrl: '',
    apiKey: '',
    model: '',
    temperature: 0.7,
    prompt: '',
    skillName: '',
    maxSteps: 5
  });
  const [llmInputParams, setLlmInputParams] = useState<LlmInputParam[]>([]);
  const [llmOutputParams, setLlmOutputParams] = useState<LlmOutputParam[]>([]);

  // LLM 全局配置 Store
  const { configs: llmGlobalConfigs, fetchAllConfigs: fetchLLMGlobalConfigs } = useLLMConfigStore();
  const providerOptions = getSupportedProviderOptions();

  // TTS 节点配置状态
  const [ttsConfig, setTtsConfig] = useState({
    provider: '',
    configId: undefined as number | undefined,
    apiUrl: '',
    apiKey: '',
    model: '',
    voice: '',
    languageType: 'Auto',
    instruction: '',
    speed: 1,
    volume: 1,
    sampleRate: 24000
  });
  const [ttsInputParams, setTtsInputParams] = useState<TtsInputParam[]>([]);
  const [ttsOutputParams, setTtsOutputParams] = useState<TtsOutputParam[]>([]);

  // 自动保存定时器
  const autoSaveTimerRef = useRef<number | null>(null);

  const resolveSelectedNodeProvider = (node: Node | null) => {
    if (!node) {
      return '';
    }

    const configuredProvider = normalizeProviderKey(String(node.data?.provider || ''));
    if (configuredProvider) {
      return configuredProvider;
    }

    return getProviderFromNodeType(String(node.data?.type || ''));
  };

  // 处理节点拖拽开始
  const handleDragStart = (event: React.DragEvent, nodeType: string, displayName: string) => {
    event.dataTransfer.setData('application/reactflow-type', nodeType);
    event.dataTransfer.setData('application/reactflow-label', displayName);
    event.dataTransfer.effectAllowed = 'move';
  };

  // 处理节点点击
  const handleNodeClick = (node: Node) => {
    console.log('Node clicked:', node);

    // 清理之前的自动保存定时器
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }

    useWorkflowStore.getState().setSelectedNode(node);

    // 加载节点配置
    if (node.data?.type === 'output') {
      setOutputParams((node.data?.outputParams as OutputParam[]) || []);
      setResponseContent((node.data?.responseContent as string) || '');
    } else if (isLlmNodeType(String(node.data?.type || ''))) {
      // 加载 LLM 节点配置
      const configId = (node.data?.configId as number) || undefined;
      const matchedGlobalConfig = configId
        ? llmGlobalConfigs.find(c => c.id === configId)
        : undefined;
      const provider = normalizeProviderKey(
        matchedGlobalConfig?.provider ||
        String(node.data?.provider || '') ||
        getProviderFromNodeType(String(node.data?.type || ''))
      );
      setLlmConfig({
        provider,
        configId,
        apiUrl: matchedGlobalConfig?.apiUrl || (node.data?.apiUrl as string) || '',
        apiKey: configId ? '' : (node.data?.apiKey as string) || '',
        model: matchedGlobalConfig?.model || (node.data?.model as string) || '',
        temperature: matchedGlobalConfig?.temperature || (node.data?.temperature as number) || 0.7,
        prompt: (node.data?.prompt as string) || '',
        skillName: (node.data?.skillName as string) || '',
        maxSteps: (node.data?.maxSteps as number) || 5
      });
      setLlmInputParams((node.data?.inputParams as LlmInputParam[]) || []);
      setLlmOutputParams((node.data?.outputParams as LlmOutputParam[]) || []);
    } else if (node.data?.type === 'tts') {
      // 加载 TTS 节点配置
      const configId = (node.data?.configId as number) || undefined;
      const matchedGlobalConfig = configId
        ? llmGlobalConfigs.find(c => c.id === configId)
        : undefined;
      const provider = normalizeProviderKey(
        matchedGlobalConfig?.provider ||
        String(node.data?.provider || '') ||
        (String(node.data?.model || '').toLowerCase().includes('step') ? 'step' : '')
      );
      setTtsConfig({
        provider,
        configId,
        apiUrl: matchedGlobalConfig?.apiUrl || (node.data?.apiUrl as string) || '',
        apiKey: configId ? '' : (node.data?.apiKey as string) || '',
        model: getTtsModelForProvider(provider, matchedGlobalConfig?.ttsModel, matchedGlobalConfig?.model || (node.data?.model as string)),
        voice: (node.data?.voice as string) || (provider === 'step' ? 'cixingnansheng' : provider === 'qwen' ? 'Cherry' : ''),
        languageType: (node.data?.languageType as string) || 'Auto',
        instruction: (node.data?.instruction as string) || '',
        speed: (node.data?.speed as number) || 1,
        volume: (node.data?.volume as number) || 1,
        sampleRate: (node.data?.sampleRate as number) || 24000
      });
      setTtsInputParams((node.data?.inputParams as TtsInputParam[]) || []);
      setTtsOutputParams((node.data?.outputParams as TtsOutputParam[]) || []);
    }
  };

  // 初始化加载 LLM 全局配置
  useEffect(() => {
    fetchLLMGlobalConfigs();
  }, [fetchLLMGlobalConfigs]);

  // 当全局配置异步加载完成后，补齐当前选中节点的展示配置
  useEffect(() => {
    if (!selectedNode) return;
    const nodeType = selectedNode.data?.type;
    if (!isLlmNodeType(String(nodeType || ''))) return;
    if (!llmConfig.configId) return;

    const config = llmGlobalConfigs.find(c => c.id === llmConfig.configId);
    if (!config) return;

    const needsSync =
      llmConfig.apiUrl !== config.apiUrl ||
      llmConfig.model !== config.model ||
      llmConfig.temperature !== config.temperature ||
      llmConfig.apiKey !== '';

    if (needsSync) {
      setLlmConfig(prev => ({
        ...prev,
        provider: normalizeProviderKey(config.provider),
        apiUrl: config.apiUrl,
        apiKey: '',
        model: config.model,
        temperature: config.temperature
      }));
    }
  }, [llmGlobalConfigs, selectedNode, llmConfig]);

  // 当全局配置异步加载完成后，补齐当前选中 TTS 节点的展示配置
  useEffect(() => {
    if (!selectedNode || selectedNode.data?.type !== 'tts') return;
    if (!ttsConfig.configId) return;

    const config = llmGlobalConfigs.find(c => c.id === ttsConfig.configId);
    if (!config) return;
    const provider = normalizeProviderKey(config.provider);
    const model = getTtsModelForProvider(provider, config.ttsModel, config.model);

    const needsSync =
      ttsConfig.apiUrl !== config.apiUrl ||
      ttsConfig.model !== model ||
      ttsConfig.apiKey !== '';

    if (needsSync) {
      setTtsConfig(prev => ({
        ...prev,
        provider,
        apiUrl: config.apiUrl,
        apiKey: '',
        model
      }));
    }
  }, [llmGlobalConfigs, selectedNode, ttsConfig]);

  // 加载指定工作流
  const loadWorkflowById = useCallback(async (workflowId: number) => {
    try {
      const result = await getWorkflow(workflowId);
      if (result.code === 200) {
        const workflow = result.data;
        setWorkflowName(workflow.name);
        setEngineType(workflow.engineType || 'dag');
        setCurrentWorkflowId(workflow.id);
        
        const flowData = JSON.parse(workflow.flowData) as WorkflowCanvasData;
        console.log('加载的工作流数据:', flowData);
        
        // 加载节点
        const loadedNodes = normalizeWorkflowNodes(flowData.nodes || []);
        setNodes(loadedNodes);
        
        // 加载连线并恢复箭头
        const loadedEdges = (flowData.edges || []).map((edge) => ({
          ...edge,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 20,
            height: 20,
          },
        }));
        setEdges(loadedEdges);
        
        // 恢复输出节点配置
        const outputNode = loadedNodes.find((node) => node.data?.type === 'output');
        console.log('找到输出节点:', outputNode);
        console.log('输出节点配置 - outputParams:', outputNode?.data?.outputParams);
        console.log('输出节点配置 - responseContent:', outputNode?.data?.responseContent);

        const rawOutputParams = outputNode?.data?.outputParams;
        const rawResponseContent = outputNode?.data?.responseContent;
        setOutputParams(Array.isArray(rawOutputParams) ? rawOutputParams as OutputParam[] : []);
        setResponseContent(typeof rawResponseContent === 'string' ? rawResponseContent : '');
        
        message.success('工作流加载成功');
      }
    } catch {
      message.error('工作流加载失败');
    }
  }, [setCurrentWorkflowId, setEdges, setNodes]);

  // 从 URL 加载工作流
  useEffect(() => {
    if (id) {
      const workflowId = parseInt(id);
      // 避免重复加载 - 使用 ref 标记
      if (hasLoadedRef.current !== workflowId) {
        hasLoadedRef.current = workflowId;
        loadWorkflowById(workflowId);
      }
    }
  }, [id, loadWorkflowById]);

  // 保存工作流
  const handleSave = async () => {
    if (nodes.length === 0) {
      message.warning('工作流为空,无法保存');
      return;
    }

    const flowData = JSON.stringify({
      nodes: serializeWorkflowNodes(nodes),
      edges: edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
      })),
    });

    setSaving(true);
    try {
      if (currentWorkflowId) {
        // 更新
        await updateWorkflow(currentWorkflowId, {
          name: workflowName,
          flowData,
          engineType,
        });
        message.success('工作流保存成功');
      } else {
        // 创建
        const result = await createWorkflow({
          name: workflowName,
          description: '通过编辑器创建',
          flowData,
          engineType,
        });
        if (result.code === 200) {
          const workflowId = result.data.id;
          setCurrentWorkflowId(workflowId);
          // 更新 URL
          navigate(`/editor/${workflowId}`, { replace: true });
          message.success('工作流创建成功');
        }
      }
    } catch {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  // 执行工作流(从调试抽屉调用)
  const handleExecute = async (inputData: string) => {
    if (!currentWorkflowId) {
      throw new Error('请先保存工作流');
    }

    const result = await executeWorkflow(currentWorkflowId, inputData);
    if (result.code === 200) {
      return result.data;
    } else {
      throw new Error(result.message || '执行失败');
    }
  };

  // 打开调试抽屉
  const handleOpenDebug = () => {
    if (!currentWorkflowId) {
      message.warning('请先保存工作流');
      return;
    }
    setDebugDrawerOpen(true);
  };

  // 登出
  const handleLogout = async () => {
    const refreshToken = getRefreshToken();
    if (refreshToken) {
      try {
        await logout({ refreshToken });
      } catch {
        // 后端退出失败不阻塞本地登出
      }
    }
    clearAuth();
    navigate('/login');
  };

  // 添加输出参数
  const handleAddOutputParam = () => {
    setOutputParams([...outputParams, { name: '', type: 'input', value: '' }]);
  };

  // 删除输出参数
  const handleRemoveOutputParam = (index: number) => {
    setOutputParams(outputParams.filter((_, i) => i !== index));
  };

  // 更新输出参数
  const handleUpdateOutputParam = (index: number, field: keyof OutputParam, value: string) => {
    const newParams = [...outputParams];
    newParams[index] = { ...newParams[index], [field]: value };
    setOutputParams(newParams);
  };

  // 获取可引用的节点列表（输出节点之前的所有节点）
  const getReferenceableNodes = () => {
    return nodes.filter(node => 
      node.id !== selectedNode?.id && node.data?.type !== 'output'
    );
  };

  // 获取节点的输出参数
  const getNodeOutputParams = (nodeType: string): string[] => {
    switch (nodeType) {
      case 'input':
        return ['user_input'];
      case 'llm':
      case 'react_agent':
      case 'openai':
      case 'deepseek':
      case 'qwen':
      case 'step':
      case 'zhipu':
      case 'ai_ping':
        return nodeType === 'react_agent'
          ? ['output', 'finalAnswer', 'steps', 'tokens']
          : ['output', 'tokens'];
      case 'tts':
        return ['audioUrl', 'fileName', 'output'];
      default:
        return ['output'];
    }
  };

  // 获取所有可引用的参数（节点.参数名格式）
  const getReferenceableParams = () => {
    const params: { label: string; value: string }[] = [];
    getReferenceableNodes().forEach(node => {
      const nodeType = (node.data?.type as string) || '';
      const nodeLabel = (node.data?.label as string) || node.id;
      const outputParams = getNodeOutputParams(nodeType);
      
      outputParams.forEach(param => {
        params.push({
          label: `${nodeLabel}.${param}`,
          value: `${node.id}.${param}`
        });
      });
    });
    return params;
  };

  // 保存输出节点配置
  const handleSaveOutputConfig = () => {
    if (!selectedNode) return;

    // 验证参数配置
    for (const param of outputParams) {
      if (!param.name) {
        message.warning('请填写所有参数名');
        return;
      }
      if (param.type === 'input' && !param.value) {
        message.warning('请填写输入值');
        return;
      }
      if (param.type === 'reference' && !param.referenceNode) {
        message.warning('请选择引用参数');
        return;
      }
    }

    // 验证回答内容配置中的参数引用
    const paramNames = new Set(outputParams.map(p => p.name));
    const templateParamRegex = /\{\{(\w+)\}\}/g;
    const matches = responseContent.matchAll(templateParamRegex);
    const undefinedParams: string[] = [];
    
    for (const match of matches) {
      const paramName = match[1];
      if (!paramNames.has(paramName)) {
        undefinedParams.push(paramName);
      }
    }
    
    if (undefinedParams.length > 0) {
      message.warning(`回答内容中引用了未定义的参数: ${undefinedParams.join(', ')}`);
      return;
    }

    // 保存到节点的 data 中
    const updatedData = {
      ...selectedNode.data,
      outputParams,
      responseContent
    };

    console.log('保存输出节点配置:', {
      nodeId: selectedNode.id,
      outputParams,
      responseContent,
      updatedData
    });

    useWorkflowStore.getState().updateNode(selectedNode.id, updatedData);
    message.success('配置保存成功');
  };

  // 打开加载工作流对话框
  const handleOpenLoadModal = async () => {
    setLoadingWorkflows(true);
    setLoadModalOpen(true);
    try {
      const result = await getWorkflows();
      if (result.code === 200) {
        setWorkflows(result.data);
      }
    } catch {
      message.error('获取工作流列表失败');
    } finally {
      setLoadingWorkflows(false);
    }
  };

  // 加载选中的工作流
  const handleLoadWorkflow = (workflow: Workflow) => {
    setLoadModalOpen(false);
    navigate(`/editor/${workflow.id}`);
  };

  // 新建工作流
  const handleCreateNew = () => {
    setCurrentWorkflowId(null);
    setWorkflowName('未命名工作流');
    
    // 创建默认的输入和输出节点(上下排列)
    setNodes(createDefaultWorkflowNodes());
    setEdges([]);
    navigate('/editor');
    message.info('已创建新工作流');
  };

  // 保存 LLM 节点配置
  const handleSaveLlmConfig = () => {
    if (!selectedNode) return;

    // 验证输入参数
    for (const param of llmInputParams) {
      if (!param.name) {
        message.warning('请填写所有参数名');
        return;
      }
      if (param.type === 'input' && !param.value) {
        message.warning('请填写输入值');
        return;
      }
      if (param.type === 'reference' && !param.referenceNode) {
        message.warning('请选择引用参数');
        return;
      }
    }

    // 验证提示词
    if (!llmConfig.prompt) {
      message.warning('请填写提示词模板');
      return;
    }

    // 验证提示词中的参数引用
    const paramNames = new Set(llmInputParams.map(p => p.name));
    const templateParamRegex = /\{\{(\w+)\}\}/g;
    const matches = llmConfig.prompt.matchAll(templateParamRegex);
    const undefinedParams: string[] = [];

    for (const match of matches) {
      const paramName = match[1];
      if (!paramNames.has(paramName)) {
        undefinedParams.push(paramName);
      }
    }

    if (undefinedParams.length > 0) {
      message.warning(`提示词模板中引用了未定义的参数: ${undefinedParams.join(', ')}`);
      return;
    }

    // 如果没有选择全局配置，需要验证 API 配置
    if (!llmConfig.configId) {
      if (!llmConfig.provider) {
        message.warning('请选择供应商');
        return;
      }
      if (!llmConfig.apiUrl) {
        message.warning('请选择全局配置或填写 API 地址');
        return;
      }
      if (!llmConfig.apiKey) {
        message.warning('请选择全局配置或填写 API 密钥');
        return;
      }
      if (!llmConfig.model) {
        message.warning('请选择全局配置或填写模型名称');
        return;
      }
    }

    const useGlobalConfig = !!llmConfig.configId;
    const updatedData = {
      ...selectedNode.data,
      provider: llmConfig.provider,
      configId: llmConfig.configId,
      apiUrl: useGlobalConfig ? '' : llmConfig.apiUrl,
      apiKey: useGlobalConfig ? '' : llmConfig.apiKey,
      model: useGlobalConfig ? '' : llmConfig.model,
      temperature: useGlobalConfig ? 0.7 : llmConfig.temperature,
      prompt: llmConfig.prompt,
      skillName: llmConfig.skillName,
      maxSteps: llmConfig.maxSteps,
      inputParams: llmInputParams,
      outputParams: llmOutputParams
    };

    useWorkflowStore.getState().updateNode(selectedNode.id, updatedData);
    message.success('配置保存成功');
  };

  // 添加 LLM 输入参数
  const handleAddLlmInputParam = () => {
    setLlmInputParams([...llmInputParams, { name: '', type: 'input', value: '' }]);
  };

  // 删除 LLM 输入参数
  const handleRemoveLlmInputParam = (index: number) => {
    setLlmInputParams(llmInputParams.filter((_, i) => i !== index));
  };

  // 更新 LLM 输入参数
  const handleUpdateLlmInputParam = (index: number, field: keyof LlmInputParam, value: string) => {
    const newParams = [...llmInputParams];
    newParams[index] = { ...newParams[index], [field]: value };
    setLlmInputParams(newParams);
  };

  // 保存 TTS 节点配置
  const handleSaveTtsConfig = () => {
    if (!selectedNode) return;

    if (!ttsConfig.configId) {
      if (!ttsConfig.provider) {
        message.warning('请选择供应商');
        return;
      }
      if (!ttsConfig.apiUrl) {
        message.warning('请选择全局配置或填写 API 地址');
        return;
      }
      if (!ttsConfig.apiKey) {
        message.warning('请选择全局配置或填写 API Key');
        return;
      }
      if (!ttsConfig.model) {
        message.warning('请选择全局配置或填写模型名称');
        return;
      }
    }

    if (normalizeProviderKey(ttsConfig.provider) === 'step' && ttsConfig.instruction.length > 200) {
      message.warning('StepAudio 2.5 TTS 的 instruction 不能超过 200 字符');
      return;
    }

    // 验证输入参数
    for (const param of ttsInputParams) {
      if (!param.name) {
        message.warning('请填写所有参数名');
        return;
      }
      if (param.type === 'input' && !param.value) {
        message.warning('请填写输入值');
        return;
      }
      if (param.type === 'reference' && !param.referenceNode) {
        message.warning('请选择引用参数');
        return;
      }
    }

    // 验证输出参数
    for (const param of ttsOutputParams) {
      if (!param.name) {
        message.warning('请填写所有输出参数名');
        return;
      }
    }

    const useGlobalConfig = !!ttsConfig.configId;
    const updatedData = {
      ...selectedNode.data,
      provider: ttsConfig.provider,
      configId: ttsConfig.configId,
      apiUrl: useGlobalConfig ? '' : ttsConfig.apiUrl,
      apiKey: useGlobalConfig ? '' : ttsConfig.apiKey,
      model: useGlobalConfig ? '' : ttsConfig.model,
      voice: ttsConfig.voice,
      languageType: ttsConfig.languageType,
      instruction: ttsConfig.instruction,
      speed: ttsConfig.speed,
      volume: ttsConfig.volume,
      sampleRate: ttsConfig.sampleRate,
      inputParams: ttsInputParams,
      outputParams: ttsOutputParams
    };

    useWorkflowStore.getState().updateNode(selectedNode.id, updatedData);
    message.success('配置保存成功');
  };

  // 添加 TTS 输入参数
  const handleAddTtsInputParam = () => {
    setTtsInputParams([...ttsInputParams, { name: '', type: 'input', value: '' }]);
  };

  // 删除 TTS 输入参数
  const handleRemoveTtsInputParam = (index: number) => {
    setTtsInputParams(ttsInputParams.filter((_, i) => i !== index));
  };

  // 更新 TTS 输入参数
  const handleUpdateTtsInputParam = (index: number, field: keyof TtsInputParam, value: string) => {
    const newParams = [...ttsInputParams];
    newParams[index] = { ...newParams[index], [field]: value };
    setTtsInputParams(newParams);
  };

  // 添加 TTS 输出参数
  const handleAddTtsOutputParam = () => {
    setTtsOutputParams([...ttsOutputParams, { name: '', value: '' }]);
  };

  // 删除 TTS 输出参数
  const handleRemoveTtsOutputParam = (index: number) => {
    setTtsOutputParams(ttsOutputParams.filter((_, i) => i !== index));
  };

  // 更新 TTS 输出参数
  const handleUpdateTtsOutputParam = (index: number, field: keyof TtsOutputParam, value: string) => {
    const newParams = [...ttsOutputParams];
    newParams[index] = { ...newParams[index], [field]: value };
    setTtsOutputParams(newParams);
  };

  // 添加 LLM 输出参数
  const handleAddLlmOutputParam = () => {
    setLlmOutputParams([...llmOutputParams, { name: '', type: 'string', description: '' }]);
  };

  // 删除 LLM 输出参数
  const handleRemoveLlmOutputParam = (index: number) => {
    setLlmOutputParams(llmOutputParams.filter((_, i) => i !== index));
  };

  // 更新 LLM 输出参数
  const handleUpdateLlmOutputParam = (index: number, field: keyof LlmOutputParam, value: string) => {
    const newParams = [...llmOutputParams];
    newParams[index] = { ...newParams[index], [field]: value };
    setLlmOutputParams(newParams);
  };

  // 自动保存输出节点配置
  useEffect(() => {
    if (!selectedNode || selectedNode.data?.type !== 'output') return;
    
    // 清理之前的定时器
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    
    // 设置新的定时器（防抖500ms）
    autoSaveTimerRef.current = setTimeout(() => {
      // 基础验证
      let hasValidData = false;
      
      // 检查是否有有效的参数配置
      if (outputParams.length > 0) {
        hasValidData = outputParams.some(param => param.name && (param.value || param.referenceNode));
      }
      
      // 或者有响应内容
      if (responseContent && responseContent.trim()) {
        hasValidData = true;
      }
      
      if (!hasValidData) return; // 没有有效数据，不保存
      
      // 保存到节点的 data 中
      const updatedData = {
        ...selectedNode.data,
        outputParams,
        responseContent
      };
      
      useWorkflowStore.getState().updateNode(selectedNode.id, updatedData);
      console.log('输出节点配置已自动保存');
    }, 500);
    
    // 清理函数
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [outputParams, responseContent, selectedNode]);

  // 自动保存 LLM 节点配置
  useEffect(() => {
    if (!selectedNode) return;
    const nodeType = selectedNode.data?.type;
    if (!isLlmNodeType(String(nodeType || ''))) return;

    // 清理之前的定时器
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    // 设置新的定时器（防抖500ms）
    autoSaveTimerRef.current = setTimeout(() => {
      // 基础验证：至少有基本配置
      const hasBasicConfig = llmConfig.configId || llmConfig.apiUrl || llmConfig.apiKey || llmConfig.model || llmConfig.prompt;
      const hasParams = llmInputParams.length > 0 || llmOutputParams.length > 0;

      if (!hasBasicConfig && !hasParams) return; // 没有任何配置，不保存

      const useGlobalConfig = !!llmConfig.configId;
      const updatedData = {
        ...selectedNode.data,
        provider: llmConfig.provider,
        configId: llmConfig.configId,
        apiUrl: useGlobalConfig ? '' : llmConfig.apiUrl,
        apiKey: useGlobalConfig ? '' : llmConfig.apiKey,
        model: useGlobalConfig ? '' : llmConfig.model,
        temperature: useGlobalConfig ? 0.7 : llmConfig.temperature,
        prompt: llmConfig.prompt,
        skillName: llmConfig.skillName,
        maxSteps: llmConfig.maxSteps,
        inputParams: llmInputParams,
        outputParams: llmOutputParams
      };

      useWorkflowStore.getState().updateNode(selectedNode.id, updatedData);
      console.log('LLM节点配置已自动保存');
    }, 500);

    // 清理函数
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [llmConfig, llmInputParams, llmOutputParams, selectedNode]);

  // 自动保存 TTS 节点配置
  useEffect(() => {
    if (!selectedNode || selectedNode.data?.type !== 'tts') return;
    
    // 清理之前的定时器
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    
    // 设置新的定时器（防抖500ms）
    autoSaveTimerRef.current = setTimeout(() => {
      // 基础验证：至少有基本配置
      const hasBasicConfig = ttsConfig.configId || ttsConfig.apiUrl || ttsConfig.apiKey || ttsConfig.model;
      const hasParams = ttsInputParams.length > 0 || ttsOutputParams.length > 0;
      
      if (!hasBasicConfig && !hasParams) return; // 没有任何配置，不保存
      
      const useGlobalConfig = !!ttsConfig.configId;
      const updatedData = {
        ...selectedNode.data,
        provider: ttsConfig.provider,
        configId: ttsConfig.configId,
        apiUrl: useGlobalConfig ? '' : ttsConfig.apiUrl,
        apiKey: useGlobalConfig ? '' : ttsConfig.apiKey,
        model: useGlobalConfig ? '' : ttsConfig.model,
        voice: ttsConfig.voice,
        languageType: ttsConfig.languageType,
        instruction: ttsConfig.instruction,
        speed: ttsConfig.speed,
        volume: ttsConfig.volume,
        sampleRate: ttsConfig.sampleRate,
        inputParams: ttsInputParams,
        outputParams: ttsOutputParams
      };
      
      useWorkflowStore.getState().updateNode(selectedNode.id, updatedData);
      console.log('TTS节点配置已自动保存');
    }, 500);
    
    // 清理函数
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [ttsConfig, ttsInputParams, ttsOutputParams, selectedNode]);

  const selectedNodeType = String(selectedNode?.data?.type || '');
  const isReActAgentNode = selectedNodeType === 'react_agent';
  const isGenericLlmNode = selectedNodeType === 'llm' || isReActAgentNode;
  const selectedNodeProvider = resolveSelectedNodeProvider(selectedNode);
  const availableLlmConfigs = isGenericLlmNode
    ? llmGlobalConfigs
    : llmGlobalConfigs.filter(
        (config) => normalizeProviderKey(config.provider) === selectedNodeProvider
      );
  const ttsProviderOptions = providerOptions.filter(option => ['qwen', 'step'].includes(option.value));
  const normalizedTtsProvider = normalizeProviderKey(ttsConfig.provider);
  const availableTtsConfigs = llmGlobalConfigs.filter(
    (config) => ['qwen', 'step'].includes(normalizeProviderKey(config.provider))
  );
  const isStepTtsProvider = normalizedTtsProvider === 'step';
  const hasTtsProvider = ['qwen', 'step'].includes(normalizedTtsProvider);
  const getDefaultTtsModel = (provider: string) => provider === 'step' ? 'stepaudio-2.5-tts' : provider === 'qwen' ? 'qwen3-tts-flash' : '';
  const getDefaultTtsVoice = (provider: string) => provider === 'step' ? 'cixingnansheng' : provider === 'qwen' ? 'Cherry' : '';
  const getTtsModelForProvider = (provider: string, ttsModel?: string | null, fallbackModel?: string | null) => {
    const normalizedProvider = normalizeProviderKey(provider);
    const explicitTtsModel = ttsModel?.trim() || '';
    if (explicitTtsModel) {
      return explicitTtsModel;
    }

    const trimmedModel = fallbackModel?.trim() || '';
    const lowerModel = trimmedModel.toLowerCase();

    if (normalizedProvider === 'step') {
      return lowerModel.includes('step') && lowerModel.includes('tts')
        ? trimmedModel
        : getDefaultTtsModel(normalizedProvider);
    }

    if (normalizedProvider === 'qwen') {
      return lowerModel.includes('tts')
        ? trimmedModel
        : getDefaultTtsModel(normalizedProvider);
    }

    return trimmedModel;
  };
  const getGlobalConfigLabel = (config: { provider: string; model?: string; ttsModel?: string }) => {
    const providerLabel = getProviderLabel(config.provider);
    const modelLabel = config.model ? `LLM: ${config.model}` : '';
    const ttsModelLabel = config.ttsModel ? `TTS: ${config.ttsModel}` : '';
    return [providerLabel, modelLabel, ttsModelLabel].filter(Boolean).join(' / ');
  };
  const selectedNodeLabel = String(selectedNode?.data?.label || selectedNode?.id || '');

  return (
    <div className="workflow-editor-shell">
      {/* 顶部工具栏 */}
      <header className="workflow-topbar">
        <div className="workflow-title-group">
          <div className="workflow-brand-mark">P</div>
          <div>
            <div className="workflow-brand">PaiAgent</div>
            <Input
              value={workflowName}
              onChange={(e) => setWorkflowName(e.target.value)}
              className="workflow-name-input"
              placeholder="工作流名称"
              bordered={false}
            />
          </div>
          <Select
            value={engineType}
            onChange={(value) => setEngineType(value)}
            className="workflow-engine-select"
            options={[
              { value: 'dag', label: 'DAG 引擎' },
              { value: 'langgraph', label: 'LangGraph 引擎' }
            ]}
          />
        </div>
        
        <div className="workflow-actions">
          <LLMConfigModal />
          <Button
            icon={<PlusOutlined />}
            onClick={handleCreateNew}
          >
            新建
          </Button>
          <Button
            icon={<FolderOpenOutlined />}
            onClick={handleOpenLoadModal}
          >
            加载
          </Button>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={handleSave}
            loading={saving}
          >
            保存
          </Button>
          <Button
            icon={<BugOutlined />}
            onClick={handleOpenDebug}
            disabled={!currentWorkflowId}
          >
            调试
          </Button>
          <div className="workflow-user">
            <span className="workflow-user-name">{username}</span>
            <Button
              icon={<LogoutOutlined />}
              onClick={handleLogout}
              type="text"
              size="small"
            >
              登出
            </Button>
          </div>
        </div>
      </header>

      {/* 主要内容区域 */}
      <div className="workflow-workbench">
        {/* 左侧节点面板 */}
        <aside className="workflow-left-panel">
          <NodePanel onDragStart={handleDragStart} />
        </aside>

        {/* 中间画布 */}
        <main className="workflow-canvas-panel">
          <FlowCanvas onNodeClick={handleNodeClick} />
        </main>

        {/* 右侧配置面板 */}
        <aside className="workflow-config-panel">
          <div className="workflow-panel-heading">
            <div>
              <p className="workflow-panel-kicker">Inspector</p>
              <h3>节点配置</h3>
            </div>
            {selectedNode && <span className="workflow-node-pill">{selectedNodeType || 'node'}</span>}
          </div>
          {selectedNode ? (
            <div className="workflow-config-body">
              <div className="workflow-selected-card">
                <div className="workflow-selected-icon">{selectedNodeLabel.slice(0, 1).toUpperCase()}</div>
                <div className="min-w-0">
                  <p className="workflow-selected-title">{selectedNodeLabel}</p>
                  <p className="workflow-selected-meta">{selectedNode.id}</p>
                </div>
              </div>
                
                {/* 输入节点配置 */}
                {selectedNode.data?.type === 'input' && (
                  <Form layout="vertical" className="workflow-config-form">
                    <Form.Item label="变量名">
                      <Input value="user_input" disabled />
                    </Form.Item>
                    <Form.Item label="变量类型">
                      <Input value="String" disabled />
                    </Form.Item>
                    <Form.Item label="描述">
                      <Input.TextArea value="用户本轮的输入内容" disabled rows={2} />
                    </Form.Item>
                    <Form.Item label="是否必要">
                      <Checkbox checked disabled>必要</Checkbox>
                    </Form.Item>
                  </Form>
                )}

                {/* 输出节点配置 */}
                {selectedNode.data?.type === 'output' && (
                  <Form layout="vertical" className="workflow-config-form">
                    {/* 输出配置 */}
                    <div className="workflow-config-section">
                      <div className="workflow-config-section-header">
                        <label className="font-medium text-gray-700">输出配置</label>
                        <Button 
                          type="dashed" 
                          size="small" 
                          icon={<PlusOutlined />}
                          onClick={handleAddOutputParam}
                        >
                          添加
                        </Button>
                      </div>
                      
                      {outputParams.map((param, index) => (
                        <div key={index} className="workflow-param-row">
                          <div>
                            <Input 
                              placeholder="参数名"
                              value={param.name}
                              onChange={(e) => handleUpdateOutputParam(index, 'name', e.target.value)}
                              style={{ width: '100px' }}
                            />
                          </div>
                          <div>
                            <Select
                              value={param.type}
                              onChange={(value) => handleUpdateOutputParam(index, 'type', value)}
                              style={{ width: '80px' }}
                            >
                              <Select.Option value="input">输入</Select.Option>
                              <Select.Option value="reference">引用</Select.Option>
                            </Select>
                          </div>
                          <div className="flex-1">
                            {param.type === 'input' ? (
                              <Input 
                                placeholder="输入值"
                                value={param.value}
                                onChange={(e) => handleUpdateOutputParam(index, 'value', e.target.value)}
                              />
                            ) : (
                              <Select
                                placeholder="选择参数"
                                value={param.referenceNode}
                                onChange={(value) => handleUpdateOutputParam(index, 'referenceNode', value)}
                                className="w-full"
                              >
                                {getReferenceableParams().map(param => (
                                  <Select.Option key={param.value} value={param.value}>
                                    {param.label}
                                  </Select.Option>
                                ))}
                              </Select>
                            )}
                          </div>
                          <Button 
                            type="text" 
                            danger 
                            size="small"
                            icon={<DeleteOutlined />}
                            onClick={() => handleRemoveOutputParam(index)}
                          />
                        </div>
                      ))}
                      
                      {outputParams.length === 0 && (
                        <div className="workflow-config-empty">
                          点击"添加"按钮添加输出参数
                        </div>
                      )}
                    </div>

                    {/* 回答内容配置 */}
                    <Form.Item label="回答内容配置">
                      <Input.TextArea 
                        rows={6}
                        placeholder="使用 {{参数名}} 引用输出配置中的参数"
                        value={responseContent}
                        onChange={(e) => setResponseContent(e.target.value)}
                      />
                      <div className="workflow-field-hint">
                        💡 提示: 使用 {'{{'} 参数名 {'}'} 引用上面定义的参数
                      </div>
                    </Form.Item>

                    <Button type="primary" block onClick={handleSaveOutputConfig}>
                      保存配置
                    </Button>
                  </Form>
                )}

                {/* LLM 节点配置 */}
                {isLlmNodeType(selectedNodeType) && (
                  <Form layout="vertical" className="workflow-config-form">
                    {/* 输入参数配置 */}
                    <div className="workflow-config-section">
                      <div className="workflow-config-section-header">
                        <label className="font-medium text-gray-700">输入参数</label>
                        <Button 
                          type="dashed" 
                          size="small" 
                          icon={<PlusOutlined />}
                          onClick={handleAddLlmInputParam}
                        >
                          添加
                        </Button>
                      </div>
                      
                      {llmInputParams.map((param, index) => (
                        <div key={index} className="workflow-param-row">
                          <Input 
                            placeholder="参数名"
                            value={param.name}
                            onChange={(e) => handleUpdateLlmInputParam(index, 'name', e.target.value)}
                            style={{ width: '90px' }}
                          />
                          <Select
                            value={param.type}
                            onChange={(value) => handleUpdateLlmInputParam(index, 'type', value)}
                            style={{ width: '70px' }}
                          >
                            <Select.Option value="input">输入</Select.Option>
                            <Select.Option value="reference">引用</Select.Option>
                          </Select>
                          <div className="flex-1">
                            {param.type === 'input' ? (
                              <Input 
                                placeholder="输入值"
                                value={param.value}
                                onChange={(e) => handleUpdateLlmInputParam(index, 'value', e.target.value)}
                              />
                            ) : (
                              <Select
                                placeholder="选择参数"
                                value={param.referenceNode}
                                onChange={(value) => handleUpdateLlmInputParam(index, 'referenceNode', value)}
                                className="w-full"
                              >
                                {getReferenceableParams().map(p => (
                                  <Select.Option key={p.value} value={p.value}>
                                    {p.label}
                                  </Select.Option>
                                ))}
                              </Select>
                            )}
                          </div>
                          <Button 
                            type="text" 
                            danger 
                            size="small"
                            icon={<DeleteOutlined />}
                            onClick={() => handleRemoveLlmInputParam(index)}
                          />
                        </div>
                      ))}
                      
                      {llmInputParams.length === 0 && (
                        <div className="workflow-config-empty">
                          点击"添加"按钮添加输入参数
                        </div>
                      )}
                    </div>

                    {/* 输出参数配置 */}
                    <div className="workflow-config-section">
                      <div className="workflow-config-section-header">
                        <label className="font-medium text-gray-700">输出参数</label>
                        <Button 
                          type="dashed" 
                          size="small" 
                          icon={<PlusOutlined />}
                          onClick={handleAddLlmOutputParam}
                        >
                          添加
                        </Button>
                      </div>
                      
                      {llmOutputParams.map((param, index) => (
                        <div key={index} className="workflow-param-row">
                          <Input 
                            placeholder="变量名"
                            value={param.name}
                            onChange={(e) => handleUpdateLlmOutputParam(index, 'name', e.target.value)}
                            style={{ width: '100px' }}
                          />
                          <Input
                            value="string"
                            disabled
                            style={{ width: '70px' }}
                          />
                          <div className="flex-1">
                            <Input 
                              placeholder="描述（可选）"
                              value={param.description}
                              onChange={(e) => handleUpdateLlmOutputParam(index, 'description', e.target.value)}
                            />
                          </div>
                          <Button 
                            type="text" 
                            danger 
                            size="small"
                            icon={<DeleteOutlined />}
                            onClick={() => handleRemoveLlmOutputParam(index)}
                          />
                        </div>
                      ))}
                      
                      {llmOutputParams.length === 0 && (
                        <div className="workflow-config-empty">
                          点击"添加"按钮添加输出参数
                        </div>
                      )}
                    </div>

                    <Form.Item label="提示词模板" required>
                      <Input.TextArea
                        rows={12}
                        placeholder="输入提示词模板，使用 {{参数名}} 引用输入参数"
                        value={llmConfig.prompt}
                        onChange={(e) => setLlmConfig({...llmConfig, prompt: e.target.value})}
                        style={{ fontFamily: 'monospace', fontSize: '12px' }}
                      />
                      <div className="workflow-field-hint">
                        💡 使用 {'{{'} 参数名 {'}'} 引用上面定义的输入参数
                      </div>
                    </Form.Item>

                    {isReActAgentNode && (
                      <Form.Item label="最大 ReAct 步数">
                        <Input
                          type="number"
                          min="1"
                          max="20"
                          value={llmConfig.maxSteps}
                          onChange={(e) => setLlmConfig({
                            ...llmConfig,
                            maxSteps: Math.min(20, Math.max(1, parseInt(e.target.value, 10) || 5))
                          })}
                        />
                        <div className="workflow-field-hint">
                          每一步只能做一次工具调用或给出最终答案，超过步数会停止执行
                        </div>
                      </Form.Item>
                    )}

                    {/* 全局配置选择 */}
                    <Form.Item
                      label="全局配置"
                      required={!llmConfig.configId && !llmConfig.apiUrl}
                    >
                      <Select
                        value={llmConfig.configId}
                        onChange={(value) => {
                          if (value) {
                            const config = llmGlobalConfigs.find(c => c.id === value);
                            if (config) {
                              setLlmConfig({
                                ...llmConfig,
                                provider: normalizeProviderKey(config.provider),
                                configId: value,
                                apiUrl: config.apiUrl,
                                apiKey: '',
                                model: config.model,
                                temperature: config.temperature
                              });
                            }
                          } else {
                            setLlmConfig({
                              ...llmConfig,
                              provider: isGenericLlmNode ? '' : selectedNodeProvider,
                              configId: undefined,
                              apiUrl: '',
                              apiKey: '',
                              model: '',
                              temperature: 0.7
                            });
                          }
                        }}
                        placeholder="选择一个全局配置"
                        allowClear
                      >
                        {availableLlmConfigs.map(config => (
                            <Select.Option key={config.id} value={config.id}>
                              {isGenericLlmNode ? getGlobalConfigLabel(config) : config.model}
                            </Select.Option>
                          ))}
                      </Select>
                      <div className="workflow-field-hint">
                        💡 选择全局配置后无需填写下方 API 信息
                      </div>
                    </Form.Item>

                    {/* API 配置（未选择全局配置时显示） */}
                    {!llmConfig.configId && (
                      <>
                        {isGenericLlmNode && (
                          <Form.Item label="供应商" required>
                            <Select
                              value={llmConfig.provider || undefined}
                              placeholder="选择这条节点配置要使用的供应商"
                              options={providerOptions}
                              onChange={(value) => setLlmConfig({ ...llmConfig, provider: value })}
                            />
                          </Form.Item>
                        )}
                        <div className="workflow-config-warning">
                          ⚠️ 未选择全局配置，请手动填写以下 API 信息
                        </div>
                        <Form.Item label="API 地址" required>
                          <Input
                            placeholder="例如: https://dashscope.aliyuncs.com/compatible-mode"
                            value={llmConfig.apiUrl}
                            onChange={(e) => setLlmConfig({...llmConfig, apiUrl: e.target.value})}
                          />
                          <div className="workflow-field-hint">
                            填写兼容接口根地址，不要追加 <code>/v1</code> 或 <code>/v1/chat/completions</code>
                          </div>
                        </Form.Item>
                        <Form.Item label="API 密钥" required>
                          <Input.Password
                            placeholder="输入 API Key"
                            value={llmConfig.apiKey}
                            onChange={(e) => setLlmConfig({...llmConfig, apiKey: e.target.value})}
                          />
                        </Form.Item>
                        <Form.Item label="模型名称" required>
                          <Input
                            placeholder="例如: deepseek-chat, claude-3-5-sonnet-20241022"
                            value={llmConfig.model}
                            onChange={(e) => setLlmConfig({...llmConfig, model: e.target.value})}
                          />
                        </Form.Item>
                        <Form.Item label="温度">
                          <Input
                            type="number"
                            step="0.1"
                            min="0"
                            max="2"
                            value={llmConfig.temperature}
                            onChange={(e) => setLlmConfig({...llmConfig, temperature: parseFloat(e.target.value) || 0.7})}
                          />
                          <div className="workflow-field-hint">
                            控制输出随机性，范围 0-2，值越高越随机
                          </div>
                        </Form.Item>
                      </>
                    )}

                    {/* 已选择全局配置时显示配置信息 */}
                    {llmConfig.configId && (
                      <div className="workflow-config-summary">
                        <div className="font-medium mb-2">当前使用全局配置：</div>
                        <div>供应商: {getProviderLabel(llmConfig.provider)}</div>
                        <div>API 地址: {llmConfig.apiUrl}</div>
                        <div>模型: {llmConfig.model}</div>
                        <div>温度: {llmConfig.temperature}</div>
                      </div>
                    )}

                    <Form.Item label="技能 (Skill)">
                      <SkillSelector
                        value={llmConfig.skillName}
                        onChange={(value) => setLlmConfig({...llmConfig, skillName: value || ''})}
                      />
                      <div className="workflow-field-hint">
                        选择一个技能来增强 LLM 的能力，LLM 会自动获取技能指南
                      </div>
                    </Form.Item>
                    <Button type="primary" block onClick={handleSaveLlmConfig}>
                      保存配置
                    </Button>
                  </Form>
                )}

                {/* TTS 节点配置 (超拟人音频) */}
                {selectedNode.data?.type === 'tts' && (
                  <Form layout="vertical" className="workflow-config-form">
                    {/* 输入配置 */}
                    <div className="workflow-config-section">
                      <div className="workflow-config-section-header">
                        <label className="font-medium text-gray-700">输入配置</label>
                        <Button 
                          type="dashed" 
                          size="small" 
                          icon={<PlusOutlined />}
                          onClick={handleAddTtsInputParam}
                        >
                          添加
                        </Button>
                      </div>
                      
                      {ttsInputParams.map((param, index) => (
                        <div key={index} className="mb-4 p-3 bg-gray-50 rounded">
                          <div className="workflow-param-row is-compact">
                            <Input 
                              placeholder="参数名 (如: text)"
                              value={param.name}
                              onChange={(e) => handleUpdateTtsInputParam(index, 'name', e.target.value)}
                              style={{ width: 120 }}
                            />
                            <Select
                              value={param.type}
                              onChange={(value) => handleUpdateTtsInputParam(index, 'type', value)}
                              style={{ width: 100 }}
                            >
                              <Select.Option value="input">输入</Select.Option>
                              <Select.Option value="reference">引用</Select.Option>
                            </Select>
                            <Button 
                              type="text" 
                              danger 
                              icon={<DeleteOutlined />}
                              onClick={() => handleRemoveTtsInputParam(index)}
                            />
                          </div>
                          <div>
                            {param.type === 'input' ? (
                              <Input.TextArea
                                placeholder="输入值"
                                value={param.value}
                                onChange={(e) => handleUpdateTtsInputParam(index, 'value', e.target.value)}
                                rows={2}
                              />
                            ) : (
                              <Select
                                placeholder="选择引用参数"
                                value={param.referenceNode}
                                onChange={(value) => handleUpdateTtsInputParam(index, 'referenceNode', value)}
                                style={{ width: '100%' }}
                              >
                                {getReferenceableParams().map((p) => (
                                  <Select.Option key={p.value} value={p.value}>
                                    {p.label}
                                  </Select.Option>
                                ))}
                              </Select>
                            )}
                          </div>
                        </div>
                      ))}
                      
                      {ttsInputParams.length === 0 && (
                        <div className="workflow-config-empty">
                          暂无输入参数,点击"添加"按钮创建 text 参数
                        </div>
                      )}
                    </div>

                    {/* 基本信息 */}
                    <div className="workflow-config-section">
                      <label className="workflow-config-section-title">基本信息</label>
                      <Form.Item label="全局配置" required={!ttsConfig.configId && !ttsConfig.apiUrl}>
                        <Select
                          value={ttsConfig.configId}
                          placeholder="选择一个通义千问或阶跃星辰配置"
                          allowClear
                          onChange={(value) => {
                            if (value) {
                              const config = llmGlobalConfigs.find(c => c.id === value);
                              if (config) {
                                const provider = normalizeProviderKey(config.provider);
                                const providerChanged = provider !== normalizedTtsProvider;
                                setTtsConfig({
                                  ...ttsConfig,
                                  provider,
                                  configId: value,
                                  apiUrl: config.apiUrl,
                                  apiKey: '',
                                  model: getTtsModelForProvider(provider, config.ttsModel, config.model),
                                  voice: providerChanged ? getDefaultTtsVoice(provider) : ttsConfig.voice
                                });
                              }
                            } else {
                              setTtsConfig({
                                ...ttsConfig,
                                configId: undefined,
                                apiUrl: '',
                                apiKey: '',
                                model: getDefaultTtsModel(normalizedTtsProvider)
                              });
                            }
                          }}
                        >
                          {availableTtsConfigs.map(config => (
                            <Select.Option key={config.id} value={config.id}>
                              {getGlobalConfigLabel(config)}
                            </Select.Option>
                          ))}
                        </Select>
                        <div className="workflow-field-hint">
                          选择全局配置后无需在节点中保存 API Key。
                        </div>
                      </Form.Item>

                      {!ttsConfig.configId && (
                        <>
                          <Form.Item label="供应商" required>
                            <Select
                              value={ttsConfig.provider}
                              options={ttsProviderOptions}
                              onChange={(value) => setTtsConfig({
                                ...ttsConfig,
                                provider: value,
                                model: getDefaultTtsModel(value),
                                voice: getDefaultTtsVoice(value)
                              })}
                            />
                          </Form.Item>
                          <div className="workflow-config-warning">
                            ⚠️ 未选择全局配置，请手动填写以下 API 信息
                          </div>
                          <Form.Item label="API 地址" required>
                            <Input
                              placeholder={isStepTtsProvider ? 'https://api.stepfun.com/v1' : 'https://dashscope.aliyuncs.com/api/v1'}
                              value={ttsConfig.apiUrl}
                              onChange={(e) => setTtsConfig({ ...ttsConfig, apiUrl: e.target.value })}
                            />
                          </Form.Item>
                          <Form.Item label="API Key" required>
                            <Input.Password
                              placeholder={isStepTtsProvider ? '请输入 StepFun API Key' : '请输入阿里百炼 API Key'}
                              value={ttsConfig.apiKey}
                              onChange={(e) => setTtsConfig({ ...ttsConfig, apiKey: e.target.value })}
                            />
                          </Form.Item>
                          <Form.Item label="模型名称" required>
                            <Input
                              placeholder={isStepTtsProvider ? 'stepaudio-2.5-tts' : 'qwen3-tts-flash'}
                              value={ttsConfig.model}
                              onChange={(e) => setTtsConfig({ ...ttsConfig, model: e.target.value })}
                            />
                          </Form.Item>
                        </>
                      )}

                      {ttsConfig.configId && (
                        <div className="workflow-config-summary">
                          <div className="font-medium mb-2">当前使用全局配置：</div>
                          <div>供应商: {getProviderLabel(ttsConfig.provider)}</div>
                          <div>API 地址: {ttsConfig.apiUrl}</div>
                          <div>模型: {ttsConfig.model}</div>
                        </div>
                      )}
                    </div>

                    {/* 语音参数 */}
                    <div className="workflow-config-section">
                      <label className="workflow-config-section-title">语音参数</label>
                      {!hasTtsProvider ? (
                        <div className="workflow-config-empty">
                          请先选择全局配置或手动选择供应商。
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <Form.Item label="音色 (voice)" className="mb-0">
                            {isStepTtsProvider ? (
                              <Input
                                placeholder="例如: cixingnansheng"
                                value={ttsConfig.voice}
                                onChange={(e) => setTtsConfig({ ...ttsConfig, voice: e.target.value })}
                              />
                            ) : (
                              <Select
                                showSearch
                                value={ttsConfig.voice || undefined}
                                onChange={(value) => setTtsConfig({ ...ttsConfig, voice: value })}
                              >
                                <Select.Option value="Cherry">Cherry (芊悦)</Select.Option>
                                <Select.Option value="Serena">Serena (苏瑶)</Select.Option>
                                <Select.Option value="Ethan">Ethan (晨煦)</Select.Option>
                                <Select.Option value="Chelsie">Chelsie (千雪)</Select.Option>
                                <Select.Option value="Momo">Momo (茉兔)</Select.Option>
                                <Select.Option value="Vivian">Vivian (十三)</Select.Option>
                                <Select.Option value="Moon">Moon (月白)</Select.Option>
                                <Select.Option value="Maia">Maia (四月)</Select.Option>
                                <Select.Option value="Kai">Kai (凯)</Select.Option>
                                <Select.Option value="Nofish">Nofish (不吃鱼)</Select.Option>
                                <Select.Option value="Bella">Bella (萌宝)</Select.Option>
                                <Select.Option value="Jennifer">Jennifer (詹妮弗)</Select.Option>
                                <Select.Option value="Ryan">Ryan (甜茶)</Select.Option>
                                <Select.Option value="Katerina">Katerina (卡捷琳娜)</Select.Option>
                                <Select.Option value="Aiden">Aiden (艾登)</Select.Option>
                              </Select>
                            )}
                          </Form.Item>

                          {!isStepTtsProvider && (
                            <Form.Item label="语言类型 (language_type)" className="mb-0">
                              <Select
                                value={ttsConfig.languageType}
                                onChange={(value) => setTtsConfig({ ...ttsConfig, languageType: value })}
                              >
                                <Select.Option value="Auto">Auto</Select.Option>
                              </Select>
                            </Form.Item>
                          )}

                          {isStepTtsProvider && (
                            <>
                              <Form.Item
                                label="全局语境 (instruction)"
                                className="mb-0"
                                help={`${ttsConfig.instruction.length}/200`}
                              >
                                <Input.TextArea
                                  rows={3}
                                  maxLength={200}
                                  placeholder="例如: 语气紧张，语速偏快，带明显压迫感"
                                  value={ttsConfig.instruction}
                                  onChange={(e) => setTtsConfig({ ...ttsConfig, instruction: e.target.value })}
                                />
                              </Form.Item>

                              <Form.Item label="语速 (speed)" className="mb-0">
                                <Input
                                  type="number"
                                  step="0.1"
                                  min="0.5"
                                  max="2"
                                  value={ttsConfig.speed}
                                  onChange={(e) => setTtsConfig({ ...ttsConfig, speed: parseFloat(e.target.value) || 1 })}
                                />
                              </Form.Item>

                              <Form.Item label="音量 (volume)" className="mb-0">
                                <Input
                                  type="number"
                                  step="0.1"
                                  min="0.1"
                                  max="2"
                                  value={ttsConfig.volume}
                                  onChange={(e) => setTtsConfig({ ...ttsConfig, volume: parseFloat(e.target.value) || 1 })}
                                />
                              </Form.Item>

                              <Form.Item label="采样率 (sample_rate)" className="mb-0">
                                <Select
                                  value={ttsConfig.sampleRate}
                                  onChange={(value) => setTtsConfig({ ...ttsConfig, sampleRate: value })}
                                >
                                  <Select.Option value={8000}>8000</Select.Option>
                                  <Select.Option value={16000}>16000</Select.Option>
                                  <Select.Option value={22050}>22050</Select.Option>
                                  <Select.Option value={24000}>24000</Select.Option>
                                  <Select.Option value={48000}>48000</Select.Option>
                                </Select>
                              </Form.Item>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    {/* 输出配置 */}
                    <div className="workflow-config-section">
                      <div className="workflow-config-section-header">
                        <label className="font-medium text-gray-700">输出配置</label>
                        <Button
                          type="dashed"
                          size="small"
                          icon={<PlusOutlined />}
                          onClick={handleAddTtsOutputParam}
                        >
                          添加
                        </Button>
                      </div>

                      {ttsOutputParams.map((param, index) => (
                        <div key={index} className="workflow-param-row">
                          <Input
                            placeholder="参数名 (如: voice_url)"
                            value={param.name}
                            onChange={(e) => handleUpdateTtsOutputParam(index, 'name', e.target.value)}
                            style={{ flex: 1 }}
                          />
                          <Input
                            placeholder="参数值 (引用字段,如: audioUrl)"
                            value={param.value}
                            onChange={(e) => handleUpdateTtsOutputParam(index, 'value', e.target.value)}
                            style={{ flex: 1 }}
                          />
                          <Button
                            type="text"
                            danger
                            icon={<DeleteOutlined />}
                            onClick={() => handleRemoveTtsOutputParam(index)}
                          />
                        </div>
                      ))}

                      {ttsOutputParams.length === 0 && (
                        <div className="workflow-config-empty">
                          暂无输出参数,点击"添加"按钮创建 voice_url 参数
                        </div>
                      )}
                    </div>

                    <Button type="primary" block onClick={handleSaveTtsConfig}>
                      保存配置
                    </Button>
                  </Form>
                )}

                {/* 其他节点配置 */}
                {selectedNode.data?.type !== 'input' &&
                 selectedNode.data?.type !== 'output' &&
                 !isLlmNodeType(selectedNodeType) &&
                 selectedNode.data?.type !== 'tts' && (
                  <div className="workflow-config-empty">
                    该节点暂无可配置项
                  </div>
                )}
              </div>
            ) : (
              <div className="workflow-empty-inspector">
                <div className="workflow-empty-icon">+</div>
                <p>未选择节点</p>
              </div>
            )}
        </aside>
      </div>

      {/* 调试抽屉 */}
      <DebugDrawer
        open={debugDrawerOpen}
        onClose={() => setDebugDrawerOpen(false)}
        onExecute={handleExecute}
      />

      {/* 加载工作流对话框 */}
      <Modal
        title="加载工作流"
        open={loadModalOpen}
        onCancel={() => setLoadModalOpen(false)}
        footer={null}
        width={600}
      >
        <List
          loading={loadingWorkflows}
          dataSource={workflows}
          renderItem={(workflow) => (
            <List.Item
              key={workflow.id}
              actions={[
                <Button type="link" onClick={() => handleLoadWorkflow(workflow)}>
                  加载
                </Button>
              ]}
            >
              <List.Item.Meta
                title={workflow.name}
                description={`创建于: ${new Date(workflow.createdAt).toLocaleString()}`}
              />
            </List.Item>
          )}
        />
      </Modal>
    </div>
  );
};

export default EditorPage;
