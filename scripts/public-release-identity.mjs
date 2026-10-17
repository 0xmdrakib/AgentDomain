import { readFileSync } from 'node:fs';

// Only a reviewed source change may activate the transferred publication identity.
const policy = JSON.parse(readFileSync(new URL('./public-release-policy.json', import.meta.url)));
if (!Object.hasOwn(policy.owners, policy.activeOwner)) throw new Error('RELEASE_POLICY_INVALID');
export const RELEASE_POLICY = Object.freeze({
  ...policy,
  owners: Object.freeze(policy.owners),
  operator: Object.freeze(policy.operator),
});

export function releaseContext(environment) {
  return {
    repository: environment.GITHUB_REPOSITORY,
    repositoryId: environment.GITHUB_REPOSITORY_ID,
    owner: environment.GITHUB_REPOSITORY_OWNER,
    ownerId: environment.GITHUB_REPOSITORY_OWNER_ID,
    actor: environment.GITHUB_ACTOR,
    actorId: environment.GITHUB_ACTOR_ID,
    triggeringActor: environment.GITHUB_TRIGGERING_ACTOR,
    workflowRef: environment.GITHUB_WORKFLOW_REF,
    ref: environment.GITHUB_REF,
    sha: environment.GITHUB_SHA,
  };
}

export function assertSourceIdentity(context) {
  if (
    !Object.hasOwn(RELEASE_POLICY.owners, context.owner ?? '') ||
    context.repository !== `${context.owner}/${RELEASE_POLICY.repository}` ||
    context.repositoryId !== RELEASE_POLICY.repositoryId ||
    context.ownerId !== RELEASE_POLICY.owners[context.owner]
  )
    throw new Error('RELEASE_CONTEXT_INVALID');
}

export function assertReleaseContext(context, publication = false, workflow) {
  assertSourceIdentity(context);
  const workflows = workflow ? [workflow] : ['publish-npm.yml', 'publish-python.yml'];
  if (
    context.ref !== 'refs/heads/main' ||
    !/^[0-9a-f]{40}$/.test(context.sha ?? '') ||
    context.actor !== RELEASE_POLICY.operator.login ||
    context.actorId !== RELEASE_POLICY.operator.id ||
    context.triggeringActor !== RELEASE_POLICY.operator.login ||
    !workflows.some(
      (file) =>
        context.workflowRef === `${context.repository}/.github/workflows/${file}@refs/heads/main`,
    ) ||
    (publication && context.owner !== RELEASE_POLICY.activeOwner)
  )
    throw new Error('RELEASE_CONTEXT_INVALID');
}
