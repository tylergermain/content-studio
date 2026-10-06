import type { FridayProxyQuota, FridayProxyState } from '../../../shared/protocol';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** Whether Codex and Claude workers run through Friday Proxy (⚙️ Settings → Workers). */
    fridayProxy: FridayProxyState;
    /** Every Friday Proxy account's quota, as last read (the ⚡ panel). */
    proxyQuota: FridayProxyQuota;
  }
  interface Topics {
    fridayProxy: true;
    proxyQuota: true;
  }
}

export const fridayProxy: Slice = {
  init(s) {
    s.fridayProxy = { url: '', hasApiKey: false, hasManagementKey: false, codex: false, claude: false };
    s.proxyQuota = { at: 0, accounts: [] };
  },
  on: {
    fridayProxy(s, m) {
      s.fridayProxy = m.state;
      return ['fridayProxy'];
    },
    'fridayProxy.quota'(s, m) {
      s.proxyQuota = m.quota;
      return ['proxyQuota'];
    },
  },
};
