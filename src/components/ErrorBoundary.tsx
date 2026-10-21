import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/** 捕获渲染期异常，避免整页黑屏：把错误显示出来，方便定位 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    // 同时打到控制台，便于开发者排查
    console.error('[ResearchFlow] 渲染崩溃：', error, info);
  }

  render() {
    if (this.state.error) {
      const { error } = this.state;
      return (
        <div style={{ padding: 24, color: '#fca5a5', fontFamily: 'monospace', lineHeight: 1.6 }}>
          <h2 style={{ color: '#fca5a5' }}>页面渲染出错（已拦截，未白屏）</h2>
          <p style={{ color: '#e8eefb' }}>{error.message}</p>
          <pre style={{ whiteSpace: 'pre-wrap', background: 'rgba(0,0,0,0.3)', padding: 12, borderRadius: 8, color: '#cbd5e1' }}>
            {error.stack}
          </pre>
          <button
            onClick={() => location.reload()}
            style={{ marginTop: 12, padding: '8px 14px', background: '#4f8cff', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}
          >
            刷新重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
