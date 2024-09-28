import * as cdk from 'aws-cdk-lib';
import * as athena from 'aws-cdk-lib/aws-athena';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as emr from 'aws-cdk-lib/aws-emr';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as serverless from 'aws-cdk-lib/aws-sam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { WorkshopVPC } from './basic-networking';

interface FederationWorkshopResourcesProps {
  vpcStack: WorkshopVPC,
}

export class FederationWorkshopResources extends Construct {
  public readonly s3Bucket: s3.Bucket;
  public readonly auroraCluster: rds.DatabaseCluster;
  // Add other public properties as needed

  constructor(scope: Construct, id: string, props: FederationWorkshopResourcesProps) {
    super(scope, id);

    const { vpcStack } = props;
    const mysqlDatabaseName = 'sales';

    // Create the S3 bucket
    this.s3Bucket = new s3.Bucket(this, 'S3Bucket', {
      bucketName: `athena-federation-workshop-${cdk.Aws.ACCOUNT_ID}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      accessControl: s3.BucketAccessControl.BUCKET_OWNER_FULL_CONTROL
    });

    const v3EngineWorkGroup = new athena.CfnWorkGroup(this, 'V3EngineWorkGroup', {
      name: 'V2EngineWorkGroup',
      recursiveDeleteOption: true,
      workGroupConfiguration: {
        enforceWorkGroupConfiguration: true,
        engineVersion: { selectedEngineVersion: 'Athena engine version 3' },
        publishCloudWatchMetricsEnabled: true,
        resultConfiguration: {
          outputLocation: `s3://${this.s3Bucket.bucketName}/`
        }
      }
    })

    const textAnalyticsUdfHandlerApplication = new serverless.CfnApplication(this, 'TextAnalyticsUdfHandlerApplication', {
      location: {
        applicationId: 'arn:aws:serverlessrepo:us-east-1:912625584728:applications/TextAnalyticsUDFHandler',
        semanticVersion: '0.4.1'
      }
    })

    const redisServerlessApplication = new serverless.CfnApplication(this, 'RedisServerlessApplication', {
      location: {
        applicationId: 'arn:aws:serverlessrepo:us-east-1:292517598671:applications/AthenaRedisConnector',
        semanticVersion: '2022.10.1'
      },
      parameters: {
        SecretNameOrPrefix: 'redis',
        AthenaCatalogName: 'redis',
        SpillBucket: this.s3Bucket.bucketName,
        SpillPrefix: 'athena-spill-redis',
        LambdaTimeout: '900',
        LambdaMemory: '3008',
        DisableSpillEncryption: 'false',
        SecurityGroupIds: vpcStack.emrSecurityGroup.securityGroupId,
        SubnetIds: cdk.Fn.join(',', [vpcStack.vpc.publicSubnets[0].subnetId, vpcStack.vpc.publicSubnets[1].subnetId, vpcStack.vpc.publicSubnets[2].subnetId])
      }
    })

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
    const dbParametergroup = new rds.ParameterGroup(this, 'DBParameterGroup', {
      description: 'CDK Sample Aurora Cluster Parameter Group',
      engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
      parameters: {
        max_connections: '300'
      }
    })
    const dbClusterParameterGroup = new rds.ParameterGroup(this, 'DBClusterParameterGroup', {
      engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
      description: 'CDK Sample Aurora Cluster Parameter Group',
      parameters: {
        time_zone: 'Asia/Taipei',
        binlog_format: 'ROW',
        binlog_checksum: 'NONE'
      }
    })
    const dbSubnetGroup = new rds.SubnetGroup(this, 'DBSubnetGroup', {
      vpc: vpcStack.vpc,
      description: 'CDK managed DB subnet group',
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    })
    this.auroraCluster = new rds.DatabaseCluster(this, 'AuroraCluster', {
      engine: rds.DatabaseClusterEngine.auroraMysql({
        version: rds.AuroraMysqlEngineVersion.VER_3_07_1
      }),
      writer: rds.ClusterInstance.provisioned('reader', {
        publiclyAccessible: false,
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.R7G, ec2.InstanceSize.LARGE),
        instanceIdentifier: mysqlDatabaseName,
        parameterGroup: dbParametergroup
      }),
      credentials: rds.Credentials.fromSecret(auroraUserPassword),
      defaultDatabaseName: mysqlDatabaseName,
      subnetGroup: dbSubnetGroup,
      parameterGroup: dbClusterParameterGroup,
      securityGroups: [vpcStack.workshopSecurityGroup],
    });
    this.auroraCluster.node.addDependency(dbClusterParameterGroup);
    this.auroraCluster.node.addDependency(dbSubnetGroup);

    const mySqlServerlessApplication = new serverless.CfnApplication(this, 'MySqlServerlessApplication', {
      location: {
        applicationId: ' arn:aws:serverlessrepo:us-east-1:292517598671:applications/AthenaMySQLConnector',
        semanticVersion: '2022.10.1'
      },
      parameters: {
        LambdaFunctionName: 'mysql',
        DefaultConnectionString: cdk.Fn.join('', ['mysql://jdbc:mysql://', this.auroraCluster.clusterEndpoint.socketAddress, '/sales?${AthenaJdbcFederation}', ]),
        SecretNamePrefix: 'AthenaJdbcFederation',
        SpillBucket: this.s3Bucket.bucketName,
        SpillPrefix: 'athena-spill-mysql',
        LambdaTimeout: '900',
        LambdaMemory: '3008',
        DisableSpillEncryption: 'false',
        SecurityGroupIds: vpcStack.workshopSecurityGroup.securityGroupId,
        SubnetIds: cdk.Fn.join(',', [vpcStack.vpc.publicSubnets[0].subnetId, vpcStack.vpc.publicSubnets[1].subnetId, vpcStack.vpc.publicSubnets[2].subnetId])
      }
    })


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
      subnetIds: vpcStack.vpc.publicSubnets.map((subnet) => subnet.subnetId),
    });

    const elasticacheCluster = new elasticache.CfnCacheCluster(this, 'ElasticacheCluster', {
      engine: 'redis',
      cacheNodeType: 'cache.t2.micro',
      numCacheNodes: 1,
      cacheSubnetGroupName: cacheSubnetGroup.ref,
      vpcSecurityGroupIds: [securityGroup.securityGroupId],
    });

    // Create Cloud9 Environment
    // const cloud9Env = new cloud9.CfnEnvironmentEC2(this, 'Cloud9IDE', {
    //   instanceType: 't2.micro',
    //   subnetId: vpc.publicSubnets[0].subnetId,
    //   automaticStopTimeMinutes: 30,
    //   name: 'Cloud9 IDE',
    // });

    // Create EMR Cluster
    // Note: EMR clusters are complex; ensure you set all required properties
    const emrCluster = new emr.CfnCluster(this, 'EMRCluster', {
      name: 'EMR-Hbase-Cluster',
      releaseLabel: 'emr-5.28.0',
      instances: {
        masterInstanceFleet: {
          name: 'master',
          instanceTypeConfigs: [
            {
              instanceType: 'm5.xlarge',
            }
          ],
          targetOnDemandCapacity: 1
        },
        coreInstanceFleet: {
          name: 'core',
          instanceTypeConfigs: [
            {
              bidPriceAsPercentageOfOnDemandPrice: 100,
              instanceType: 'm4.xlarge',
              weightedCapacity: 4
            },
            {
              bidPriceAsPercentageOfOnDemandPrice: 100,
              instanceType: 'r4.xlarge',
              weightedCapacity: 4
            },
            {
              bidPriceAsPercentageOfOnDemandPrice: 100,
              instanceType: 'r5.xlarge',
              weightedCapacity: 4
            }
          ],
          targetOnDemandCapacity: 8,
          targetSpotCapacity: 1
        },
        terminationProtected: false,
        ec2SubnetIds: vpcStack.vpc.publicSubnets.map((subnet) => subnet.subnetId),
        additionalMasterSecurityGroups: [vpcStack.emrSecurityGroup.securityGroupId],
        additionalSlaveSecurityGroups: [vpcStack.emrSecurityGroup.securityGroupId],
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
    new cdk.CfnOutput(this,'V2WorkGroup', {value: v3EngineWorkGroup.ref})
  }
}