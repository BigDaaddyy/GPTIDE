const { Bridge, findCodex } = require('../builtin/bridge.cjs');
(async () => {
  const bridge = new Bridge(findCodex(), __dirname);
  try {
    await bridge.start();
    const { account } = await bridge.call('account/read', { refreshToken: false });
    const { data } = await bridge.call('model/list', { limit: 50, includeHidden: false });
    console.log(JSON.stringify({ accountType: account?.type, plan: account?.planType, models: data.map(m => m.model) }));
  } finally { bridge.dispose(); }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
