import * as cdk from 'aws-cdk-lib';
import * as athena from 'aws-cdk-lib/aws-athena';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface ExplorationWorkGroupsProps {
  readonly athenaWorkshopBucket: s3.IBucket;
}

export class ExplorationWorkGroups extends Construct {
  public readonly workgroupA: athena.CfnWorkGroup;
  public readonly workgroupB: athena.CfnWorkGroup;
  public readonly workgroupIcebergPreview: athena.CfnWorkGroup;

  constructor(scope: Construct, id: string, props: ExplorationWorkGroupsProps) {
    super(scope, id);

    const { athenaWorkshopBucket } = props;

    // Create Athena WorkGroup A
    this.workgroupA = new athena.CfnWorkGroup(this, 'workgroupA', {
      name: 'workgroupA',
      recursiveDeleteOption: true,
      workGroupConfiguration: {
        publishCloudWatchMetricsEnabled: true,
        resultConfiguration: {
          outputLocation: `s3://${athenaWorkshopBucket.bucketName}/`,
        },
      },
    });

    // Create Athena WorkGroup B
    this.workgroupB = new athena.CfnWorkGroup(this, 'workgroupB', {
      name: 'workgroupB',
      recursiveDeleteOption: true,
    });

    // Create Athena WorkGroup for Iceberg Preview
    this.workgroupIcebergPreview = new athena.CfnWorkGroup(this, 'workgroupIcebergPreview', {
      name: 'AmazonAthenaIcebergPreview',
      recursiveDeleteOption: true,
      workGroupConfiguration: {
        enforceWorkGroupConfiguration: true,
        engineVersion: {
          selectedEngineVersion: 'Athena engine version 3',
        },
        publishCloudWatchMetricsEnabled: true,
        resultConfiguration: {
          outputLocation: `s3://${athenaWorkshopBucket.bucketName}/`,
        },
      },
    });

    new cdk.CfnOutput(this, 'AthenaWorkGroupA', { value: this.workgroupA.ref });
    new cdk.CfnOutput(this, 'AthenaWorkGroupB', { value: this.workgroupB.ref });
    new cdk.CfnOutput(this, 'AthenaWorkGroupIcebergPreview', { value: this.workgroupIcebergPreview.ref });
  }
}