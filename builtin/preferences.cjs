function values(config) {
  const pick = (key, options, fallback) => { const value = config.get(key); return options.includes(value) ? value : fallback; };
  const bound = (key, min, max, fallback) => { const value = config.get(key); return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback; };
  return {
    autoConnect: config.get('connection.autoConnect', false) === true,
    rpcTimeout: bound('connection.timeoutSeconds', 10, 180, 45) * 1000,
    approvalPolicy: pick('approvalPolicy', ['on-request', 'untrusted', 'never'], 'on-request'),
    networkAccess: config.get('agent.networkAccess', false) === true,
    defaultMode: pick('defaultMode', ['agent', 'ask', 'plan'], 'agent'),
    defaultEffort: pick('reasoningEffort', ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'], 'medium'),
    submitKey: pick('chat.submitKey', ['enter', 'ctrlEnter'], 'enter'),
    importLimit: bound('context.importLimit', 20000, 300000, 180000),
    reviewStorageLimitMb: bound('review.storageLimitMb', 32, 512, 128),
    reviewMaxCheckpoints: bound('review.maxCheckpoints', 1, 50, 20)
  };
}
module.exports = { values };
