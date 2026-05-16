import { useEffect, useState } from 'react';
import { Drawer, Input, Button, Progress, Tag, Collapse, Alert } from 'antd';
import { PlayCircleOutlined, CheckCircleOutlined, CloseCircleOutlined, LoadingOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import AudioPlayer from './AudioPlayer';
import { buildBackendUrl } from '../config/api';
import {
  ExecutionEvent,
  ExecutionNodeResult,
  ExecutionResponse as PersistedExecutionResponse,
  executeWorkflowStream,
  getLatestExecution,
} from '../api/workflow';
import { useWorkflowStore } from '../store/workflowStore';

const { TextArea } = Input;

interface NodeResult {
  nodeId: string;
  nodeName: string;
  status: 'SUCCESS' | 'FAILED' | 'RUNNING';
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  duration: number;
  error?: string;
}

interface ExecutionResponse {
  executionId: number;
  status: 'SUCCESS' | 'FAILED' | 'RUNNING';
  nodeResults: NodeResult[];
  outputData: unknown;
  duration: number;
  errorMessage?: string;
}

interface DebugDrawerProps {
  open: boolean;
  onClose: () => void;
  onExecute: (inputData: string) => Promise<ExecutionResponse>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const parseJsonIfPossible = (value: string) => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
};

const normalizeValue = (value: unknown): unknown => (
  typeof value === 'string' ? parseJsonIfPossible(value) : value
);

const getFriendlyOutputText = (value: unknown): string | null => {
  const normalizedValue = typeof value === 'string' ? parseJsonIfPossible(value) : value;

  if (typeof normalizedValue === 'string') {
    return normalizedValue;
  }

  if (isRecord(normalizedValue) && typeof normalizedValue.output === 'string') {
    return normalizedValue.output;
  }

  return null;
};

const truncateText = (value: unknown, maxLength = 180) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

const getToolTrace = (value: unknown): Record<string, unknown>[] => {
  const normalized = normalizeValue(value);
  const record = isRecord(normalized) && isRecord(normalized.output)
    ? normalized.output
    : normalized;

  if (!isRecord(record) || !Array.isArray(record.toolTrace)) {
    return [];
  }

  return record.toolTrace.filter((item): item is Record<string, unknown> => isRecord(item));
};

const summarizeToolInput = (toolInput: unknown) => {
  if (!isRecord(toolInput)) {
    return truncateText(toolInput, 120);
  }

  const query = typeof toolInput.query === 'string' ? toolInput.query : '';
  if (query) {
    return `query="${truncateText(query, 120)}"`;
  }

  const urls = Array.isArray(toolInput.urls) ? toolInput.urls : undefined;
  if (urls && urls.length > 0) {
    return `urls=${urls.length}`;
  }

  return truncateText(toolInput, 120);
};

const summarizeObservation = (observation: unknown) => {
  if (!isRecord(observation)) {
    return truncateText(observation, 160);
  }

  if (typeof observation.error === 'string') {
    return `失败: ${truncateText(observation.error, 160)}`;
  }

  const summary = typeof observation.summary === 'string'
    ? observation.summary
    : typeof observation.content === 'string'
      ? observation.content
      : '';
  const citations = Array.isArray(observation.citations) ? observation.citations.length : 0;
  const results = Array.isArray(observation.results) ? observation.results.length : 0;
  const parts = [
    summary ? `结果="${truncateText(summary, 120)}"` : '',
    results > 0 ? `results=${results}` : '',
    citations > 0 ? `citations=${citations}` : '',
  ].filter(Boolean);

  return parts.join('；') || truncateText(observation, 160);
};

const formatToolTraceLog = (traceItem: Record<string, unknown>) => {
  const toolName = typeof traceItem.toolName === 'string' ? traceItem.toolName : '';
  if (!toolName) {
    return null;
  }

  const step = typeof traceItem.step === 'number' ? `#${traceItem.step}` : '';
  const inputSummary = summarizeToolInput(traceItem.toolInput);
  const observationSummary = summarizeObservation(traceItem.observation);
  return `🔎 ReAct 工具调用${step ? ` ${step}` : ''}: ${toolName}${inputSummary ? ` | ${inputSummary}` : ''}${observationSummary ? ` | ${observationSummary}` : ''}`;
};

const formatToolTraceLogs = (output: unknown) => (
  getToolTrace(output)
    .map(formatToolTraceLog)
    .filter((log): log is string => Boolean(log))
);

const formatDuration = (milliseconds: number | string | undefined | null) => {
  const ms = typeof milliseconds === 'string'
    ? Number.parseInt(milliseconds, 10)
    : milliseconds;

  if (!Number.isFinite(ms) || !ms || ms <= 0) {
    return '0秒';
  }

  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  let seconds = totalSeconds - minutes * 60;

  if (minutes > 0) {
    seconds = Math.round(seconds);
    if (seconds === 60) {
      return `${minutes + 1}分0秒`;
    }
    return `${minutes}分${seconds}秒`;
  }

  if (totalSeconds < 10) {
    return `${Number(totalSeconds.toFixed(1))}秒`;
  }

  return `${Math.round(totalSeconds)}秒`;
};

const DebugValue = ({ value, preferOutputText = false }: { value: unknown; preferOutputText?: boolean }) => {
  const friendlyText = preferOutputText ? getFriendlyOutputText(value) : null;

  if (friendlyText !== null) {
    return (
      <div className="debug-markdown-output">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {friendlyText}
        </ReactMarkdown>
      </div>
    );
  }

  return (
    <pre className="debug-json-block">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
};

const RichOutput = ({ value, preferOutputText = false }: { value: unknown; preferOutputText?: boolean }) => {
  const normalized = normalizeValue(value);
  const record = isRecord(normalized) && isRecord(normalized.output)
    ? normalized.output
    : normalized;

  if (isRecord(record)) {
    const imageUrls = Array.isArray(record.imageUrls)
      ? record.imageUrls.filter((url): url is string => typeof url === 'string')
      : (typeof record.imageUrl === 'string' ? [record.imageUrl] : []);
    const videoUrl = typeof record.videoUrl === 'string' ? record.videoUrl : null;
    const summary = typeof record.summary === 'string' ? record.summary : null;
    const context = typeof record.context === 'string' ? record.context : null;
    const citations = Array.isArray(record.citations) ? record.citations : [];

    if (imageUrls.length > 0 || videoUrl || summary || context || citations.length > 0) {
      return (
        <div className="space-y-3">
          {imageUrls.length > 0 && (
            <div className="debug-media-grid">
              {imageUrls.map((url) => (
                <img key={url} src={url} alt="generated" className="debug-generated-image" />
              ))}
            </div>
          )}
          {videoUrl && (
            <video src={videoUrl} controls className="debug-generated-video" />
          )}
          {(summary || context) && (
            <DebugValue value={summary || context} preferOutputText />
          )}
          {citations.length > 0 && (
            <div className="debug-citation-list">
              {citations.map((citation, index) => (
                <Tag key={`${String(citation)}-${index}`}>{String(citation)}</Tag>
              ))}
            </div>
          )}
          <DebugValue value={record} preferOutputText={preferOutputText} />
        </div>
      );
    }
  }

  return <DebugValue value={value} preferOutputText={preferOutputText} />;
};

const DebugDrawer = ({ open, onClose }: DebugDrawerProps) => {
  const [inputData, setInputData] = useState('');
  const [executing, setExecuting] = useState(false);
  const [executionResult, setExecutionResult] = useState<ExecutionResponse | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [nodeStatusMap, setNodeStatusMap] = useState<Map<string, NodeResult>>(new Map());
  const { currentWorkflowId } = useWorkflowStore();

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, `[${timestamp}] ${message}`]);
  };

  const normalizeNodeResult = (nodeResult: ExecutionNodeResult): NodeResult => {
    const input = normalizeValue(nodeResult.input);
    const output = normalizeValue(nodeResult.output);

    return {
      nodeId: nodeResult.nodeId,
      nodeName: nodeResult.nodeName,
      status: nodeResult.status,
      input: isRecord(input) ? input : {},
      output: isRecord(output) ? output : {},
      duration: nodeResult.duration || 0,
      error: nodeResult.error,
    };
  };

  const extractInputText = (inputData: unknown) => {
    const normalizedInput = normalizeValue(inputData);
    if (typeof normalizedInput === 'string') {
      return normalizedInput;
    }
    if (isRecord(normalizedInput) && typeof normalizedInput.input === 'string') {
      return normalizedInput.input;
    }
    return '';
  };

  const restoreExecution = (result: PersistedExecutionResponse) => {
    const restoredNodeResults = (result.nodeResults || []).map(normalizeNodeResult);
    const restoredResult: ExecutionResponse = {
      executionId: result.executionId,
      status: result.status,
      nodeResults: restoredNodeResults,
      outputData: normalizeValue(result.outputData),
      duration: result.duration || 0,
      errorMessage: result.errorMessage,
    };

    setInputData(extractInputText(result.inputData));
    setExecutionResult(restoredResult);
    setNodeStatusMap(new Map(restoredNodeResults.map((node) => [node.nodeId, node])));

    const restoredLogs = [
      `已加载最近一次执行记录 #${result.executionId}`,
      ...restoredNodeResults.flatMap((node) => {
        const nodeLog = node.status === 'FAILED'
          ? `❌ 节点 [${node.nodeName}] 执行失败${node.error ? `: ${node.error}` : ''}`
          : `✅ 节点 [${node.nodeName}] 执行成功,耗时 ${formatDuration(node.duration)}`;
        const toolLogs = formatToolTraceLogs(node.output);
        return [nodeLog, ...toolLogs];
      }),
      `${result.status === 'SUCCESS' ? '✅' : '❌'} 工作流执行${result.status === 'SUCCESS' ? '成功' : '失败'},总耗时 ${formatDuration(result.duration)}`,
    ];

    setLogs(restoredLogs.map((message) => `[历史] ${message}`));
  };

  const addProgressLog = (event: ExecutionEvent) => {
    addLog(`📊 ${event.message}`);
    if (isRecord(event.data)) {
      const toolTraceLog = formatToolTraceLog(event.data);
      if (toolTraceLog) {
        addLog(toolTraceLog);
      }
    }
  };

  const addNodeSuccessLog = (node: NodeResult) => {
    addLog(`✅ 节点 [${node.nodeName}] 执行成功,耗时 ${formatDuration(node.duration)}`);
    formatToolTraceLogs(node.output).forEach(addLog);
  };

  const loadLatestExecution = async () => {
    if (!currentWorkflowId || executing) {
      return;
    }

    try {
      const result = await getLatestExecution(currentWorkflowId);
      if (result.code === 200 && result.data) {
        restoreExecution(result.data);
      } else if (result.code === 200) {
        setExecutionResult(null);
        setLogs([]);
        setNodeStatusMap(new Map());
      }
    } catch (error) {
      console.warn('加载最近一次执行记录失败:', error);
    }
  };

  useEffect(() => {
    if (!open || executing) {
      return;
    }

    loadLatestExecution();
  }, [open, currentWorkflowId]);

  const handleExecute = async () => {
    if (!inputData.trim()) {
      addLog('❌ 错误: 输入数据不能为空');
      return;
    }

    if (!currentWorkflowId) {
      addLog('❌ 错误: 请先保存工作流');
      return;
    }

    setExecuting(true);
    setExecutionResult(null);
    setLogs([]);
    setNodeStatusMap(new Map());
    addLog('🚀 开始执行工作流...');

    try {
      const nodeResults: NodeResult[] = [];
      const tempNodeStatusMap = new Map<string, NodeResult>();
      
      await executeWorkflowStream(
        currentWorkflowId,
        inputData,
        (event: ExecutionEvent) => {
          console.log('收到事件:', event);
          
          switch (event.eventType) {
            case 'WORKFLOW_START':
              addLog('🚀 工作流开始执行');
              break;
              
            case 'NODE_START':
              addLog(`📍 节点 [${event.nodeName}] 开始执行...`);
              if (event.nodeId && event.nodeName) {
                const nodeResult: NodeResult = {
                  nodeId: event.nodeId,
                  nodeName: event.nodeName,
                  status: 'RUNNING',
                  input: {},
                  output: {},
                  duration: 0
                };
                tempNodeStatusMap.set(event.nodeId, nodeResult);
                setNodeStatusMap(new Map(tempNodeStatusMap));
              }
              break;
              
            case 'NODE_SUCCESS':
              if (event.nodeId && event.nodeName) {
                const duration = event.message?.match(/耗时 (\d+)ms/)?.[1] || '0';
                
                const eventData = isRecord(event.data) ? event.data : {};
                const nodeResult: NodeResult = {
                  nodeId: event.nodeId,
                  nodeName: event.nodeName,
                  status: 'SUCCESS',
                  input: isRecord(eventData.input) ? eventData.input : {},
                  output: isRecord(eventData.output) ? eventData.output : isRecord(event.data) ? event.data : {},
                  duration: parseInt(duration)
                };
                addNodeSuccessLog(nodeResult);
                tempNodeStatusMap.set(event.nodeId, nodeResult);
                nodeResults.push(nodeResult);
                setNodeStatusMap(new Map(tempNodeStatusMap));
              }
              break;
              
            case 'NODE_PROGRESS':
              if (event.nodeId && event.message) {
                addProgressLog(event);
                const existingNode = tempNodeStatusMap.get(event.nodeId);
                if (existingNode) {
                  existingNode.status = 'RUNNING';
                  setNodeStatusMap(new Map(tempNodeStatusMap));
                }
              }
              break;
              
            case 'NODE_ERROR':
              if (event.nodeId && event.nodeName) {
                addLog(`❌ 节点 [${event.nodeName}] 执行失败: ${event.message}`);
                const nodeResult: NodeResult = {
                  nodeId: event.nodeId,
                  nodeName: event.nodeName,
                  status: 'FAILED',
                  input: {},
                  output: {},
                  duration: 0,
                  error: event.message
                };
                tempNodeStatusMap.set(event.nodeId, nodeResult);
                nodeResults.push(nodeResult);
                setNodeStatusMap(new Map(tempNodeStatusMap));
              }
              break;
              
            case 'WORKFLOW_COMPLETE': {
              const totalDuration = event.message?.match(/总耗时 (\d+)ms/)?.[1] || '0';
              addLog(`${event.status === 'SUCCESS' ? '✅' : '❌'} 工作流执行${event.status === 'SUCCESS' ? '成功' : '失败'},总耗时 ${formatDuration(totalDuration)}`);
              
              setExecutionResult({
                executionId: 0,
                status: event.status as 'SUCCESS' | 'FAILED',
                nodeResults: Array.from(tempNodeStatusMap.values()),
                outputData: event.data || {},
                duration: parseInt(totalDuration),
                errorMessage: event.status === 'FAILED' ? event.message : undefined
              });
              break;
            }
          }
        },
        () => {
          setExecuting(false);
        },
        (error: Error) => {
          const errorMsg = error.message.includes('连接失败') 
            ? '连接失败,请检查后端服务是否运行或重新登录' 
            : error.message;
          addLog(`❌ 执行异常: ${errorMsg}`);
          setExecuting(false);
        }
      );
    } catch (error) {
      addLog(`❌ 执行异常: ${error instanceof Error ? error.message : '未知错误'}`);
      setExecuting(false);
    }
  };

  const getProgress = () => {
    if (!executionResult) {
      const total = nodeStatusMap.size;
      if (total === 0) return 0;
      const completed = Array.from(nodeStatusMap.values()).filter((r) => r.status === 'SUCCESS').length;
      return Math.round((completed / total) * 100);
    }
    const total = executionResult.nodeResults.length;
    if (total === 0) return 0;
    const completed = executionResult.nodeResults.filter((r) => r.status === 'SUCCESS').length;
    return Math.round((completed / total) * 100);
  };

  const renderNodeResultItem = (nodeResult: NodeResult) => {
    let statusColor = 'default';
    let statusIcon = <LoadingOutlined />;
    
    if (nodeResult.status === 'SUCCESS') {
      statusColor = 'success';
      statusIcon = <CheckCircleOutlined />;
    } else if (nodeResult.status === 'FAILED') {
      statusColor = 'error';
      statusIcon = <CloseCircleOutlined />;
    } else if (nodeResult.status === 'RUNNING') {
      statusColor = 'processing';
      statusIcon = <LoadingOutlined />;
    }

    return {
      key: nodeResult.nodeId,
      label: (
        <div className="debug-node-collapse-label">
          <span className="debug-node-name">
            {statusIcon} {nodeResult.nodeName}
          </span>
          <Tag color={statusColor}>{formatDuration(nodeResult.duration)}</Tag>
        </div>
      ),
      children: (
        <div className="debug-node-result-body">
          <div>
            <div className="debug-field-label">输入数据</div>
            <DebugValue value={nodeResult.input} preferOutputText />
          </div>
          <div>
            <div className="debug-field-label">输出数据</div>
            <RichOutput value={nodeResult.output} preferOutputText />
          </div>
          {nodeResult.error && (
            <Alert message="错误信息" description={nodeResult.error} type="error" showIcon />
          )}
        </div>
      ),
    };
  };

  const currentNodeResults = executionResult 
    ? executionResult.nodeResults 
    : Array.from(nodeStatusMap.values());

  return (
    <Drawer
      title="调试面板"
      placement="right"
      onClose={onClose}
      open={open}
      width={520}
      className="debug-drawer"
      styles={{ body: { padding: 0 } }}
    >
      <div className="debug-drawer-content">
        <section className="debug-panel-section">
          <div className="debug-section-header">
            <div>
              <div className="debug-section-kicker">Test input</div>
              <h3>输入测试文本</h3>
            </div>
          </div>
          <TextArea
            rows={4}
            placeholder="请输入测试文本,例如: 人工智能的未来发展"
            value={inputData}
            onChange={(e) => setInputData(e.target.value)}
            disabled={executing}
            className="debug-input-area"
          />
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            onClick={handleExecute}
            loading={executing}
            block
            className="debug-run-button"
          >
            {executing ? '执行中...' : '执行工作流'}
          </Button>
        </section>

        {(executing || executionResult) && (
          <section className="debug-panel-section">
            <div className="debug-section-header">
              <div>
                <div className="debug-section-kicker">Run status</div>
                <h3>执行状态</h3>
              </div>
              {executionResult && <span className="debug-duration">{formatDuration(executionResult.duration)}</span>}
            </div>
            <div className="debug-status-card">
              {executing && !executionResult && (
                <div className="flex items-center gap-2">
                  <LoadingOutlined className="text-blue-500" />
                  <span>执行中...</span>
                </div>
              )}
              {(executionResult || nodeStatusMap.size > 0) && (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <span>
                      状态:{' '}
                      <Tag color={executionResult?.status === 'SUCCESS' ? 'success' : executionResult?.status === 'FAILED' ? 'error' : 'processing'}>
                        {executionResult?.status === 'SUCCESS' ? '成功' : executionResult?.status === 'FAILED' ? '失败' : '执行中'}
                      </Tag>
                    </span>
                  </div>
                  <Progress 
                    percent={getProgress()} 
                    status={executionResult?.status === 'SUCCESS' ? 'success' : executionResult?.status === 'FAILED' ? 'exception' : 'active'} 
                  />
                  <div className="mt-2 text-sm text-gray-600">
                    已完成节点: {currentNodeResults.filter((r) => r.status === 'SUCCESS').length} / {currentNodeResults.length}
                  </div>
                </>
              )}
            </div>
          </section>
        )}

        {currentNodeResults.length > 0 && (
          <section className="debug-panel-section">
            <div className="debug-section-header">
              <div>
                <div className="debug-section-kicker">Nodes</div>
                <h3>节点执行结果</h3>
              </div>
              <span className="debug-count-pill">{currentNodeResults.length}</span>
            </div>
            <Collapse
              items={currentNodeResults.map(renderNodeResultItem)}
              defaultActiveKey={currentNodeResults.map((r) => r.nodeId)}
              bordered={false}
              ghost
              className="debug-result-collapse"
            />
          </section>
        )}

        {executionResult && executionResult.status === 'SUCCESS' && (
          <section className="debug-panel-section">
            <div className="debug-section-header">
              <div>
                <div className="debug-section-kicker">Final</div>
                <h3>最终输出</h3>
              </div>
            </div>
            <div className="debug-final-output">
              {(() => {
                let audioUrl: string | null = null;
                let fileName: string | undefined = undefined;
                
                let outputData = executionResult.outputData;
                if (typeof outputData === 'string') {
                  outputData = parseJsonIfPossible(outputData);
                }
                
                if (isRecord(outputData)) {
                  fileName = typeof outputData.fileName === 'string' ? outputData.fileName : undefined;
                  
                  if (typeof outputData.audioUrl === 'string') {
                    audioUrl = outputData.audioUrl;
                  }
                  
                  if (!audioUrl && typeof outputData.output === 'string') {
                    const output = outputData.output;
                    if (output.includes('http://') || output.includes('https://')) {
                      audioUrl = output;
                    } else if (output.includes('<audio') && output.includes('src=')) {
                      const srcMatch = output.match(/src="([^"]+)"/);
                      if (srcMatch && srcMatch[1]) {
                        audioUrl = srcMatch[1];
                      }
                    } else if (output.startsWith('/audio/')) {
                      audioUrl = buildBackendUrl(output);
                    }
                  }
                }
                
                console.log('检测到的 audioUrl:', audioUrl);
                
                if (audioUrl) {
                  return (
                    <AudioPlayer 
                      audioUrl={audioUrl}
                      fileName={fileName}
                    />
                  );
                }
                
                return (
                  <RichOutput value={executionResult.outputData} preferOutputText />
                );
              })()}
            </div>
          </section>
        )}

        <section className="debug-panel-section">
          <div className="debug-section-header">
            <div>
              <div className="debug-section-kicker">Logs</div>
              <h3>执行日志</h3>
            </div>
          </div>
          <div className="debug-log-list">
            {logs.map((log, index) => (
              <div
                key={index}
                className={`debug-log-line ${log.includes('❌') ? 'is-error' : log.includes('✅') ? 'is-success' : ''}`}
              >
                {log}
              </div>
            ))}
            {logs.length === 0 && (
              <div className="debug-empty-log">暂无日志</div>
            )}
          </div>
        </section>
      </div>
    </Drawer>
  );
};

export default DebugDrawer;
