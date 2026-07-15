import { Component, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  failed: boolean
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return <main className="status-page"><section><span>500</span><h1>页面显示失败</h1><p>浏览器在显示 PicNest 时遇到异常，请刷新页面重试。</p><button className="button button-primary" onClick={() => window.location.reload()}>刷新页面</button></section></main>
    }
    return this.props.children
  }
}
