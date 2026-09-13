import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from 'node:test';
import ts from 'typescript';

it('published declarations accept normal Base clients and reject numeric IDs or boolean approval', () => {
  const filename = fileURLToPath(new URL('renewal-workflow.consumer.virtual.ts', import.meta.url));
  const source = `
    import {createPublicClient,createWalletClient,http} from 'viem';
    import {base} from 'viem/chains';
    import {inspectAgentIdentity,inspectAgentRenewal,prepareAutoRenewChange,executeAutoRenewChange,
      confirmAutoRenewChange,type AutoRenewChangeInput} from '../dist/index.js';
    const publicClient=createPublicClient({chain:base,ccipRead:false,transport:http()});
    const walletClient=createWalletClient({chain:base,transport:http()});
    const input:AutoRenewChangeInput={tokenId:'1',expectedOwner:'0x1111111111111111111111111111111111111111',enabled:true,builderCode:'test'};
    await inspectAgentIdentity({tokenId:'1'},{publicClient});
    // @ts-expect-error Identity token IDs must remain decimal strings.
    await inspectAgentIdentity({tokenId:9007199254740993},{publicClient});
    const observed=await inspectAgentRenewal({tokenId:'1'},{publicClient});
    if(observed.status==='found') {
      const balance:string=observed.vault.availableAtomicUsdc;
      // @ts-expect-error Atomic amounts must not silently become JS numbers.
      const unsafeBalance:number=observed.vault.availableAtomicUsdc;
      void balance;void unsafeBalance;
    }
    const plan=await prepareAutoRenewChange(input,{publicClient});
    await executeAutoRenewChange(plan,{publicClient,walletClient,approve:async()=>false});
    await confirmAutoRenewChange(plan,'0x1234',{publicClient});
    // @ts-expect-error A model-supplied approval boolean is not a host callback.
    await executeAutoRenewChange(plan,{walletClient,approve:true});
    // @ts-expect-error Token IDs must remain decimal strings.
    await prepareAutoRenewChange({...input,tokenId:9007199254740993});
  `;
  const options = {
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
  };
  const host = ts.createCompilerHost(options),
    originalSource = host.getSourceFile,
    originalExists = host.fileExists;
  host.getSourceFile = (name, language, error, fresh) =>
    resolve(name) === resolve(filename)
      ? ts.createSourceFile(name, source, language, true)
      : originalSource(name, language, error, fresh);
  host.fileExists = (name) => resolve(name) === resolve(filename) || originalExists(name);
  // This virtual consumer is never written or executed; only its types are checked.
  const program = ts.createProgram([filename], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(
    diagnostics.length,
    0,
    ts.formatDiagnostics(diagnostics, {
      getCurrentDirectory: () => process.cwd(),
      getCanonicalFileName: (name) => name,
      getNewLine: () => '\n',
    }),
  );
});
