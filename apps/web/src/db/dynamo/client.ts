import { createDocumentClient } from '@agentdomain/storage';
import { getServerEnv } from '@/lib/env';

export function getDynamoConfig() {
  const env = getServerEnv();
  return {
    region: env.AWS_REGION,
    tableName: env.DYNAMODB_TABLE_NAME,
    gsi1Name: env.DYNAMODB_GSI1_NAME,
    endpoint: env.DYNAMODB_ENDPOINT,
  };
}

export function getDynamoClient() {
  return createDocumentClient(getDynamoConfig());
}
