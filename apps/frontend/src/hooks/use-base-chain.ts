'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAccount, useChainId, useSwitchChain } from 'wagmi';
import { toast } from 'sonner';
import {
  BASE_MAINNET_CHAIN_ID,
  BaseChainRequiredError,
  getBaseChainSwitchCopy,
} from '@/lib/base-chain';

type ConnectorChange = { chainId?: number };

type ConnectorEmitter = {
  on?: (event: 'change', listener: (change: ConnectorChange) => void) => void;
  off?: (event: 'change', listener: (change: ConnectorChange) => void) => void;
};

export function useBaseChainGuard() {
  const wagmiChainId = useChainId();
  const { connector, isConnected } = useAccount();
  const { switchChainAsync, isPending } = useSwitchChain();
  const [connectorChainId, setConnectorChainId] = useState<number | null>(null);

  const readConnectorChainId = useCallback(async () => {
    if (!connector?.getChainId) return null;
    try {
      return await connector.getChainId();
    } catch {
      return null;
    }
  }, [connector]);

  useEffect(() => {
    if (!connector || !isConnected) {
      setConnectorChainId(null);
      return;
    }

    let active = true;
    void readConnectorChainId().then((chainId) => {
      if (active) setConnectorChainId(chainId);
    });

    const emitter = (connector as typeof connector & { emitter?: ConnectorEmitter }).emitter;
    const onChange = (change: ConnectorChange) => {
      if (typeof change.chainId === 'number') {
        setConnectorChainId(change.chainId);
        return;
      }
      void readConnectorChainId().then((chainId) => {
        if (active) setConnectorChainId(chainId);
      });
    };

    emitter?.on?.('change', onChange);
    return () => {
      active = false;
      emitter?.off?.('change', onChange);
    };
  }, [connector, isConnected, readConnectorChainId]);

  const effectiveChainId = connectorChainId ?? wagmiChainId;
  const isBaseChain = !isConnected || effectiveChainId === BASE_MAINNET_CHAIN_ID;

  const ensureBaseChain = useCallback(async () => {
    const currentChainId = (await readConnectorChainId()) ?? effectiveChainId;
    if (!isConnected || currentChainId === BASE_MAINNET_CHAIN_ID) {
      if (currentChainId === BASE_MAINNET_CHAIN_ID) setConnectorChainId(currentChainId);
      return true;
    }

    try {
      const switched = await switchChainAsync({ chainId: BASE_MAINNET_CHAIN_ID });
      const nextChainId = (await readConnectorChainId()) ?? switched.id;
      setConnectorChainId(nextChainId);

      if (nextChainId !== BASE_MAINNET_CHAIN_ID) {
        throw new BaseChainRequiredError();
      }
      return true;
    } catch (error) {
      const copy = getBaseChainSwitchCopy(error);
      if (copy.kind === 'cancelled') {
        toast.info(copy.title, { description: copy.description });
      } else {
        toast.error(copy.title, { description: copy.description });
      }
      return false;
    }
  }, [effectiveChainId, isConnected, readConnectorChainId, switchChainAsync]);

  return {
    effectiveChainId,
    isBaseChain,
    isSwitchingBase: isPending,
    ensureBaseChain,
  };
}
