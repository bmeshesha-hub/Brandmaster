"use client";

import React from "react";

type State = { error: Error | null; clearing: boolean };

export default class ClientErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { error: null, clearing: false };

  static getDerivedStateFromError(error: Error): State {
    return { error, clearing: false };
  }

  componentDidCatch(error: Error) {
    console.error("Brandmaster workspace error", error);
  }

  async recover() {
    this.setState({ clearing: true });
    // Preserve the Corporate GitHub token, cached account, and team-member identity.
    localStorage.removeItem("brandmaster-data-v1");
    localStorage.removeItem("brandmaster-active-view");
    localStorage.removeItem("brandmaster-guided-walkthrough-v2");
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase("brandmaster-offline-data");
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    });
    location.reload();
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <main className="workspace-recovery"><section><small>BRANDMASTER WORKSPACE RECOVERY</small><h1>The saved browser workspace needs repair</h1><p>Your Corporate GitHub token and selected team member will be preserved. Brandmaster will clear only the damaged local workspace cache, reload, and pull the shared team data again after you use Save &amp; pull.</p><details><summary>Technical details</summary><code>{this.state.error.message}</code></details><div><button className="primary" disabled={this.state.clearing} onClick={() => void this.recover()}>{this.state.clearing ? "Repairing…" : "Repair local workspace"}</button><button className="secondary" onClick={() => this.setState({ error: null, clearing: false })}>Try again</button></div></section></main>;
  }
}
