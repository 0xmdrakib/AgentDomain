import { config as loadEnv } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ResourceInUseException,
  UpdateTimeToLiveCommand,
  waitUntilTableExists,
  type BillingMode,
} from '@aws-sdk/client-dynamodb';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(__dirname, '..');

loadEnv({ path: resolve(webRoot, '.env.local'), override: true });

async function main() {
  const region = process.env.AWS_REGION ?? 'us-east-1';
  const tableName = process.env.DYNAMODB_TABLE_NAME ?? 'agentdomain-prod';
  const gsiName = process.env.DYNAMODB_GSI1_NAME ?? 'GSI1';
  const capacityMode = process.env.DYNAMODB_CAPACITY_MODE ?? 'PROVISIONED';
  const endpoint = process.env.DYNAMODB_ENDPOINT || undefined;

  const client = new DynamoDBClient({ region, endpoint });
  const billingMode = capacityMode === 'PAY_PER_REQUEST' ? 'PAY_PER_REQUEST' : 'PROVISIONED';

  try {
    await client.send(
      new CreateTableCommand({
        TableName: tableName,
        BillingMode: billingMode as BillingMode,
        AttributeDefinitions: [
          { AttributeName: 'PK', AttributeType: 'S' },
          { AttributeName: 'SK', AttributeType: 'S' },
          { AttributeName: 'GSI1PK', AttributeType: 'S' },
          { AttributeName: 'GSI1SK', AttributeType: 'S' },
        ],
        KeySchema: [
          { AttributeName: 'PK', KeyType: 'HASH' },
          { AttributeName: 'SK', KeyType: 'RANGE' },
        ],
        ProvisionedThroughput:
          billingMode === 'PROVISIONED'
            ? { ReadCapacityUnits: 10, WriteCapacityUnits: 10 }
            : undefined,
        GlobalSecondaryIndexes: [
          {
            IndexName: gsiName,
            KeySchema: [
              { AttributeName: 'GSI1PK', KeyType: 'HASH' },
              { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
            ProvisionedThroughput:
              billingMode === 'PROVISIONED'
                ? { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
                : undefined,
          },
        ],
        TableClass: 'STANDARD',
      }),
    );
    console.log(`Created DynamoDB table ${tableName}`);
  } catch (e) {
    if (e instanceof ResourceInUseException) {
      console.log(`DynamoDB table ${tableName} already exists`);
    } else {
      throw e;
    }
  }

  await waitUntilTableExists({ client, maxWaitTime: 120 }, { TableName: tableName });
  await client.send(
    new UpdateTimeToLiveCommand({
      TableName: tableName,
      TimeToLiveSpecification: {
        AttributeName: 'ttl',
        Enabled: true,
      },
    }),
  );

  const table = await client.send(new DescribeTableCommand({ TableName: tableName }));
  console.log(
    JSON.stringify(
      {
        tableName,
        status: table.Table?.TableStatus,
        billingMode,
        gsiName,
        ttlAttribute: 'ttl',
        baseCapacity: billingMode === 'PROVISIONED' ? '10 RCU / 10 WCU' : 'on-demand',
        gsiCapacity: billingMode === 'PROVISIONED' ? '5 RCU / 5 WCU' : 'on-demand',
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
