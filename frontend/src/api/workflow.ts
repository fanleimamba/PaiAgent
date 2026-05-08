import api from '../utils/request';
import { buildBackendUrl } from '../config/api';
import { clearStoredAuth, ensureValidAccessToken } from '../utils/auth';

export interface NodeDefinition {
  id: number;
  nodeType: string;
  displayName: string;
  category: string;
  icon: string;
  inputSchema: string;
  outputSchema: string;
  configSchema: string;
}

export interface WorkflowData {
  name: string;
  description?: string;
  flowData: string;
  engineType?: string;
}

export interface Workflow {
  id: number;
  name: string;
  description: string;
  flowData: string;
  engineType?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiResult<T> {
  code: number;
  message: string;
  data: T;
}

export interface ExecutionNodeResult {
  nodeId: string;
  nodeName: string;
  status: 'SUCCESS' | 'FAILED' | 'RUNNING';
  input?: unknown;
  output?: unknown;
  duration?: number;
  error?: string;
}

export interface ExecutionResponse {
  executionId: number;
  status: 'SUCCESS' | 'FAILED' | 'RUNNING';
  inputData?: unknown;
  nodeResults: ExecutionNodeResult[];
  outputData: unknown;
  duration: number;
  errorMessage?: string;
}

/**
 * 获取所有节点类型
 */
export const getNodeTypes = (): Promise<ApiResult<NodeDefinition[]>> => {
  return api.get('/api/node-types');
};

/**
 * 创建工作流
 */
export const createWorkflow = (data: WorkflowData): Promise<ApiResult<Workflow>> => {
  return api.post('/api/workflows', data);
};

/**
 * 获取工作流列表
 */
export const getWorkflows = (): Promise<ApiResult<Workflow[]>> => {
  return api.get('/api/workflows');
};

/**
 * 获取工作流详情
 */
export const getWorkflow = (id: number): Promise<ApiResult<Workflow>> => {
  return api.get(`/api/workflows/${id}`);
};

/**
 * 更新工作流
 */
export const updateWorkflow = (id: number, data: WorkflowData): Promise<ApiResult<Workflow>> => {
  return api.put(`/api/workflows/${id}`, data);
};

/**
 * 删除工作流
 */
export const deleteWorkflow = (id: number): Promise<ApiResult<void>> => {
  return api.delete(`/api/workflows/${id}`);
};

/**
 * 执行工作流
 */
export const executeWorkflow = (id: number, inputData: string): Promise<ApiResult<any>> => {
  return api.post(`/api/workflows/${id}/execute`, { inputData });
};

/**
 * 获取最近一次执行记录
 */
export const getLatestExecution = (id: number): Promise<ApiResult<ExecutionResponse | null>> => {
  return api.get(`/api/workflows/${id}/executions/latest`);
};

export interface ExecutionEvent {
  eventType: string;
  nodeId?: string;
  nodeName?: string;
  status?: string;
  message?: string;
  data?: any;
  timestamp?: number;
}

export const executeWorkflowStream = async (
  id: number, 
  inputData: string, 
  onEvent: (event: ExecutionEvent) => void,
  onComplete: () => void,
  onError: (error: Error) => void
) => {
  const token = await ensureValidAccessToken();
  
  if (!token) {
    clearStoredAuth();
    window.location.href = '/login';
    onError(new Error('未登录'));
    return null;
  }
  
  const url = buildBackendUrl(
    `/api/workflows/${id}/execute/stream?inputData=${encodeURIComponent(inputData)}&token=${token}`
  );
  
  const eventSource = new EventSource(url);
  
  let hasReceivedData = false;
  
  eventSource.addEventListener('WORKFLOW_START', (e) => {
    hasReceivedData = true;
    const event = JSON.parse(e.data) as ExecutionEvent;
    onEvent(event);
  });
  
  eventSource.addEventListener('NODE_START', (e) => {
    hasReceivedData = true;
    const event = JSON.parse(e.data) as ExecutionEvent;
    onEvent(event);
  });
  
  eventSource.addEventListener('NODE_SUCCESS', (e) => {
    hasReceivedData = true;
    const event = JSON.parse(e.data) as ExecutionEvent;
    onEvent(event);
  });
  
  eventSource.addEventListener('NODE_PROGRESS', (e) => {
    hasReceivedData = true;
    const event = JSON.parse(e.data) as ExecutionEvent;
    onEvent(event);
  });
  
  eventSource.addEventListener('NODE_ERROR', (e) => {
    hasReceivedData = true;
    const event = JSON.parse(e.data) as ExecutionEvent;
    onEvent(event);
  });
  
  eventSource.addEventListener('WORKFLOW_COMPLETE', (e) => {
    hasReceivedData = true;
    const event = JSON.parse(e.data) as ExecutionEvent;
    onEvent(event);
    eventSource.close();
    onComplete();
  });
  
  eventSource.addEventListener('ERROR', (e) => {
    hasReceivedData = true;
    const event = JSON.parse(e.data) as ExecutionEvent;
    onEvent(event);
    eventSource.close();
    onError(new Error(event.message || '执行失败'));
  });
  
  eventSource.onerror = () => {
    eventSource.close();
    
    if (!hasReceivedData) {
      clearStoredAuth();
      window.location.href = '/login';
      onError(new Error('认证失败,请重新登录'));
    } else {
      onError(new Error('连接中断'));
    }
  };
  
  return eventSource;
};
