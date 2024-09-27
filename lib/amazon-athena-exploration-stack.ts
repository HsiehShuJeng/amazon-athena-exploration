import * as cdk from 'aws-cdk-lib';
import * as athena from 'aws-cdk-lib/aws-athena';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { ExplorationWorkGroups } from './groups';

export class AmazonAthenaExplorationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create the S3 bucket
    const bucketName = `athena-workshop-${this.account}`;
    const athenaWorkshopBucket = new s3.Bucket(this, 'AthenaWorkShopBucket', {
      bucketName: bucketName,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const workGroups = new ExplorationWorkGroups(this, 'WorkGroups', {athenaWorkshopBucket: athenaWorkshopBucket})
    workGroups.node.addDependency(athenaWorkshopBucket);

    // Create Athena Named Queries
    const basicsCustomerCsv = new athena.CfnNamedQuery(this, 'basicscustomercsv', {
      database: 'default',
      description: 'Create table customers_csv',
      name: 'Athena_create_customers_csv',
      queryString: `
        CREATE EXTERNAL TABLE customers_csv (
          card_id bigint,
          customer_id bigint,
          lastname string,
          firstname string,
          email string,
          address string,
          birthday string,
          country string)
        ROW FORMAT DELIMITED
        FIELDS TERMINATED BY ','
        STORED AS INPUTFORMAT
          'org.apache.hadoop.mapred.TextInputFormat'
        OUTPUTFORMAT
          'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat'
        LOCATION
          's3://${athenaWorkshopBucket.bucketName}/basics/csv/customers/'
        TBLPROPERTIES (
          'areColumnsQuoted'='false',
          'classification'='csv',
          'columnsOrdered'='true',
          'compressionType'='none',
          'delimiter'=',',
          'skip.header.line.count'='1',
          'typeOfData'='file');`,
    });

    // Repeat similar blocks for the other named queries...
    // For brevity, these are not included but follow the same pattern.

    // Create Secrets Manager Secret
    const labsUserPassword = new secretsmanager.Secret(this, 'LabsUserPassword', {
      description: 'Athena Workshop User Password',
      secretName: '/athenaworkshopuser/password',
      generateSecretString: {
        secretStringTemplate: '{}',
        generateStringKey: 'password',
        passwordLength: 30,
      },
    });

    // Create IAM Users and Policies for userA
    const userA = new iam.User(this, 'userA', {
      userName: 'userA',
      password: labsUserPassword.secretValueFromJson('password'),
      passwordResetRequired: false,
    });

    const userAPolicyStatements = [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          's3:Put*',
          's3:Get*',
          's3:List*',
          'glue:*',
          'cloudwatch:*',
          'athena:ListNamedQueries',
          'athena:ListWorkGroups',
          'athena:GetExecutionEngine',
          'athena:GetExecutionEngines',
          'athena:GetNamespace',
          'athena:GetCatalogs',
          'athena:GetNamespaces',
          'athena:GetTables',
          'athena:GetTable',
        ],
        resources: ['*'],
      }),
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'athena:StartQueryExecution',
          'athena:GetQueryResults',
          'athena:DeleteNamedQuery',
          'athena:GetNamedQuery',
          'athena:ListQueryExecutions',
          'athena:StopQueryExecution',
          'athena:GetQueryResultsStream',
          'athena:ListNamedQueries',
          'athena:CreateNamedQuery',
          'athena:GetQueryExecution',
          'athena:BatchGetNamedQuery',
          'athena:BatchGetQueryExecution',
        ],
        resources: [
          `arn:aws:athena:${this.region}:${this.account}:workgroup/workgroupA`,
        ],
      }),
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'athena:DeleteWorkGroup',
          'athena:UpdateWorkGroup',
          'athena:GetWorkGroup',
          'athena:CreateWorkGroup',
        ],
        resources: [
          `arn:aws:athena:${this.region}:${this.account}:workgroup/workgroupA`,
        ],
      }),
    ];

    const userAPolicy = new iam.Policy(this, 'Athena-WorkgroupA-Policy', {
      policyName: 'Athena-WorkgroupA-Policy',
      statements: userAPolicyStatements,
    });

    userAPolicy.attachToUser(userA);

    // Repeat similar blocks for userB with appropriate modifications for workgroupB...

    // Outputs
    new cdk.CfnOutput(this, 'S3Bucket', {
      description: 'S3 bucket',
      value: athenaWorkshopBucket.bucketName,
    });

    new cdk.CfnOutput(this, 'ConsoleLogin', {
      description: 'LoginUrl',
      value: `https://${this.account}.signin.aws.amazon.com/console`,
    });

    new cdk.CfnOutput(this, 'ConsolePassword', {
      description:
        'AWS Secrets URL to find the generated password for User A and User B',
      value: `https://console.aws.amazon.com/secretsmanager/home?region=${this.region}#/secret?name=/athenaworkshopuser/password`,
    });
  }
}