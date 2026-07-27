"use client";

import React from "react";

type State = { error: Error | null; clearing: boolean; confirmRepair: boolean };

export default class ClientErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { error: null, clearing: false, confirmRepair: false };

  static getDerivedStateFromError(error: Error): State {
    return { error, clearing: false, confirmRepair: false };
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
    const unsynced = localStorage.getItem("brandmaster-unsynced-recovery") === "true";
    return <main className="workspace-recovery"><section><small>BRANDMASTER WORKSPACE RECOVERY</small><h1>The saved browser workspace needs repair</h1><p>Try a normal reload first; it releases page memory without deleting saved data. Repair is the last resort because it clears the local workspace cache, while preserving the Corporate GitHub token and selected team member.</p>{unsynced && <p className="workspace-recovery-unsynced"><b>Unsaved team changes detected.</b> The latest local copy may not have reached the shared workspace. Try reloading before repairing the local data.</p>}<details><summary>Technical details</summary><code>{this.state.error.message}</code></details><div><button className="primary" onClick={() => location.reload()}><span>Reload without clearing data</span></button>{this.state.confirmRepair ? <button className="danger" disabled={this.state.clearing} onClick={() => void this.recover()}>{this.state.clearing ? "Repairing…" : "Confirm clear local workspace"}</button> : <button className="secondary" onClick={() => this.setState({ confirmRepair: true })}>Repair local workspace…</button>}<button className="secondary" onClick={() => this.setState({ error: null, clearing: false, confirmRepair: false })}>Try again</button></div></section></main>;
  }
}
