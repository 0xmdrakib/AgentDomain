export type InjectedProvider = {
  request: (...args: never[]) => unknown;
  isMetaMask?: true;
  isRabby?: true;
  isCoinbaseWallet?: true;
  isBaseWallet?: true;
  providers?: InjectedProvider[];
};

export type Eip6963ProviderDetail = {
  info: { uuid: string; name: string; icon?: string; rdns: string };
  provider: InjectedProvider;
};

const MAX_WALLET_NAME_LENGTH = 128;
const MAX_WALLET_ICON_LENGTH = 256 * 1024;

export function walletIconSource(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > MAX_WALLET_ICON_LENGTH) return;
  // EIP-6963 icons are data images. Never fetch a provider-controlled tracking URL,
  // and render SVG only as an <img>, never as inline markup or an embedded document.
  const comma = value.indexOf(',');
  if (comma < 0 || comma === value.length - 1) return;
  const header = value.slice(0, comma).toLowerCase();
  if (
    /^data:image\/(?:png|webp|svg\+xml|jpeg|gif)(?:;charset=(?:utf-8|us-ascii))?(?:;base64)?$/.test(
      header,
    )
  )
    return value;
}

export function readEip6963ProviderDetail(value: unknown): Eip6963ProviderDetail | null {
  try {
    if (!value || typeof value !== 'object') return null;
    const { info, provider } = value as Eip6963ProviderDetail;
    if (!info || !provider || typeof provider.request !== 'function') return null;
    const { uuid, name, rdns } = info;
    if (
      typeof uuid !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid) ||
      typeof name !== 'string' ||
      !name.trim() ||
      name.length > MAX_WALLET_NAME_LENGTH ||
      /[\u0000-\u001f\u007f]/.test(name) ||
      typeof rdns !== 'string' ||
      rdns.length > 253 ||
      !rdns.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
    )
      return null;

    return { info: { uuid, name, rdns, icon: walletIconSource(info.icon) }, provider };
  } catch {
    // Ignore malformed announcements, including metadata properties with throwing getters.
    return null;
  }
}
