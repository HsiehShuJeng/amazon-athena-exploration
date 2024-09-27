import * as cdk from 'aws-cdk-lib';
import * as cloud9 from 'aws-cdk-lib/aws-cloud9';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as emr from 'aws-cdk-lib/aws-emr';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

interface FederationWorkshopResourcesProps {
  vpc: ec2.IVpc;
  securityGroup: ec2.ISecurityGroup;
}

export class FederationWorkshopResources extends Construct {
  public readonly s3Bucket: s3.Bucket;
  public readonly auroraCluster: rds.DatabaseCluster;
  // Add other public properties as needed

  constructor(scope: Construct, id: string, props: FederationWorkshopResourcesProps) {
    super(scope, id);

    const { vpc, securityGroup } = props;

    // Create the S3 bucket
    this.s3Bucket = new s3.Bucket(this, 'S3Bucket', {
      bucketName: `athena-federation-workshop-${cdk.Aws.ACCOUNT_ID}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Create Secrets Manager Secret for Aurora
    const auroraUserPassword = new secretsmanager.Secret(this, 'AuroraUserPassword', {
      description: 'Athena Workshop User Password',
      secretName: 'AthenaJdbcFederation',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'master' }),
        generateStringKey: 'password',
        passwordLength: 32,
        excludeCharacters: '"@/\\',
      },
    });

    // Create RDS Aurora Cluster
    this.auroraCluster = new rds.DatabaseCluster(this, 'AuroraCluster', {
      engine: rds.DatabaseClusterEngine.auroraMysql({
        version: rds.AuroraMysqlEngineVersion.VER_3_07_1
      }),
      credentials: rds.Credentials.fromSecret(auroraUserPassword),
      defaultDatabaseName: 'sales',
      instances: 1,
      instanceProps: {
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.R5, ec2.InstanceSize.LARGE),
        vpc,
        securityGroups: [securityGroup],
        publiclyAccessible: false,
      },
      parameterGroup: new rds.ParameterGroup(this, 'AuroraDBParameterGroup', {
        engine: rds.DatabaseClusterEngine.auroraMysql({
          version: rds.AuroraMysqlEngineVersion.VER_3_07_1
        }),
        parameters: {
          binlog_format: 'ROW',
          binlog_checksum: 'NONE',
          time_zone: 'Asia/Taipei'
        },
      }),
    });

    // Create DynamoDB Tables
    const ddbPartTable = new dynamodb.Table(this, 'DDBPartTable', {
      tableName: 'part',
      partitionKey: { name: 'p_partkey', type: dynamodb.AttributeType.NUMBER },
      readCapacity: 50,
      writeCapacity: 200,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const ddbPartSuppTable = new dynamodb.Table(this, 'DDBPartSuppTable', {
      tableName: 'partsupp',
      partitionKey: { name: 'ps_partkey', type: dynamodb.AttributeType.NUMBER },
      sortKey: { name: 'ps_suppkey', type: dynamodb.AttributeType.NUMBER },
      readCapacity: 50,
      writeCapacity: 200,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create ElastiCache Cluster
    const cacheSubnetGroup = new elasticache.CfnSubnetGroup(this, 'CacheSubnetGroup', {
      description: 'Cache subnet group',
      subnetIds: vpc.publicSubnets.map((subnet) => subnet.subnetId),
    });

    const elasticacheCluster = new elasticache.CfnCacheCluster(this, 'ElasticacheCluster', {
      engine: 'redis',
      cacheNodeType: 'cache.t2.micro',
      numCacheNodes: 1,
      cacheSubnetGroupName: cacheSubnetGroup.ref,
      vpcSecurityGroupIds: [securityGroup.securityGroupId],
    });

    // Create Cloud9 Environment
    const cloud9Env = new cloud9.CfnEnvironmentEC2(this, 'Cloud9IDE', {
      instanceType: 't2.micro',
      subnetId: vpc.publicSubnets[0].subnetId,
      automaticStopTimeMinutes: 30,
      name: 'Cloud9 IDE',
    });

    // Create EMR Cluster
    // Note: EMR clusters are complex; ensure you set all required properties
    const emrCluster = new emr.CfnCluster(this, 'EMRCluster', {
      name: 'EMR-Hbase-Cluster',
      releaseLabel: 'emr-5.28.0',
      instances: {
        instanceFleets: [
          {
            instanceFleetType: 'MASTER',
            targetOnDemandCapacity: 1,
            instanceTypeConfigs: [{ instanceType: 'm5.xlarge' }],
          },
          {
            instanceFleetType: 'CORE',
            targetOnDemandCapacity: 8,
            instanceTypeConfigs: [
              { instanceType: 'm4.xlarge' },
              { instanceType: 'r4.xlarge' },
              { instanceType: 'r5.xlarge' },
            ],
          },
        ],
        ec2SubnetIds: vpc.publicSubnets.map((subnet) => subnet.subnetId),
        additionalMasterSecurityGroups: [securityGroup.securityGroupId],
        additionalSlaveSecurityGroups: [securityGroup.securityGroupId],
      },
      jobFlowRole: 'EMR_EC2_DefaultRole', // Ensure the role exists or create a new one
      serviceRole: 'EMR_DefaultRole', // Ensure the role exists or create a new one
      visibleToAllUsers: true,
      applications: [
        { name: 'Hadoop' },
        { name: 'Hbase' },
        { name: 'Livy' },
        { name: 'Hive' },
        { name: 'Tez' },
      ],
      logUri: `s3://${this.s3Bucket.bucketName}/elasticmapreduce/`,
    });

    // Create Glue Database and Tables
    const glueDatabase = new glue.CfnDatabase(this, 'GlueDatabaseRedis', {
      catalogId: cdk.Aws.ACCOUNT_ID,
      databaseInput: {
        name: 'redis',
        description: 'Database to hold tables for redis data',
        locationUri: 's3://fake-bucket?redis-db-flag=redis-db-flag',
      },
    });

    // Additional resources like Lambda functions, IAM roles, and policies can be added similarly.

    // Outputs can be added if needed
    new cdk.CfnOutput(this, 'S3BucketName', {
      value: this.s3Bucket.bucketName,
    });
  }
}