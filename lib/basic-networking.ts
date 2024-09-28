// workshop-vpc.ts
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

interface WorkshopVPCProps extends cdk.NestedStackProps {

}

export class WorkshopVPC extends cdk.NestedStack {
  public readonly vpc: ec2.Vpc;
  public readonly emrSecurityGroup: ec2.SecurityGroup;
  public readonly workshopSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props?: WorkshopVPCProps) {
    super(scope, id);

    // Create the VPC
    this.vpc = new ec2.Vpc(this, 'VPC', {
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
      maxAzs: 3,
      natGateways: 0,
      enableDnsSupport: true,
      enableDnsHostnames: true,
      createInternetGateway: true,
      subnetConfiguration: [
        {
          cidrMask: 20,
          name: 'PublicSubnet',
          subnetType: ec2.SubnetType.PUBLIC,
        },
      ],
    });
    const networkAcl = new cdk.aws_ec2.NetworkAcl(this, 'NetworkAcl', { vpc: this.vpc,
        subnetSelection: {
            subnetType: ec2.SubnetType.PUBLIC
        },
     });
    networkAcl.addEntry('InPublicAllowAll', {
        cidr: ec2.AclCidr.anyIpv4(),
        ruleNumber: 99,
        traffic: ec2.AclTraffic.allTraffic(),
        direction: ec2.TrafficDirection.INGRESS,
        ruleAction: ec2.Action.ALLOW,
    });
    networkAcl.addEntry('OutPublicAllowAll', {
        cidr: ec2.AclCidr.anyIpv4(),
        ruleNumber: 99,
        traffic: ec2.AclTraffic.allTraffic(),
        direction: ec2.TrafficDirection.EGRESS,
        ruleAction: ec2.Action.ALLOW,
    });

    this.emrSecurityGroup = new ec2.SecurityGroup(this, 'EMRSecurityGroup', {
      vpc: this.vpc,
      allowAllOutbound: true,
      securityGroupName: 'EMRSecurityGroup',
      description: 'Enable SSH access via port 22',
    });
    new ec2.CfnSecurityGroupIngress(this, 'EMRSecurityGroupIngress',{
        ipProtocol: 'tcp',
        fromPort: 0,
        toPort: 65535,
        sourceSecurityGroupId: this.emrSecurityGroup.securityGroupId,
        groupId: this.emrSecurityGroup.securityGroupId,
    })
    this.emrSecurityGroup.addEgressRule(
        ec2.Peer.anyIpv4(),
        ec2.Port.allTcp()
    )

    this.workshopSecurityGroup = new ec2.SecurityGroup(this, 'WorkshopSecurityGroup', {
      vpc: this.vpc,
      allowAllOutbound: true,
      securityGroupName: 'WorkshopSecurityGroup',
      description: 'Enable SSH access via port 22',
    });
    this.workshopSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(3306)
    );
    this.workshopSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
    );
    this.workshopSecurityGroup.addIngressRule(
      this.emrSecurityGroup,
      ec2.Port.allTraffic(),
    );
    this.workshopSecurityGroup.addEgressRule(
        ec2.Peer.anyIpv4(),
        ec2.Port.allTcp()
    )
    this.workshopSecurityGroup.node.addDependency(this.emrSecurityGroup)

    const s3VpcEndpoint = this.vpc.addGatewayEndpoint('S3VPCEndpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
      subnets: [{ subnetType: ec2.SubnetType.PUBLIC }],
    });
    s3VpcEndpoint.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        principals: [new cdk.aws_iam.AnyPrincipal()],
        actions: ['*'],
        resources: ['*']
      })
    );

    this.vpc.addInterfaceEndpoint('GlueVPCEndpoint', {
      service: new ec2.InterfaceVpcEndpointService(
        `com.amazonaws.${cdk.Aws.REGION}.glue`
      ),
      subnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [this.workshopSecurityGroup],
      privateDnsEnabled: true,
    });

    this.vpc.addInterfaceEndpoint('SecretsManagerVPCEndpoint', {
      service: new ec2.InterfaceVpcEndpointService(
        `com.amazonaws.${cdk.Aws.REGION}.secretsmanager`,
        443
      ),
      subnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [this.workshopSecurityGroup],
      privateDnsEnabled: true,
    });

    new cdk.CfnOutput(this, 'VPCId', { value: this.vpc.vpcId });
    new cdk.CfnOutput(this, 'PublicSubnet1Id', { value: this.vpc.publicSubnets[0].subnetId });
    new cdk.CfnOutput(this, 'PublicSubnet2Id', { value: this.vpc.publicSubnets[1].subnetId });
    new cdk.CfnOutput(this, 'PublicSubnet3Id', { value: this.vpc.publicSubnets[2].subnetId });
    new cdk.CfnOutput(this, 'WorkshopSecurityGroupId', { value: this.workshopSecurityGroup.securityGroupId });
    new cdk.CfnOutput(this, 'EMRSecurityGroupId', { value: this.emrSecurityGroup.securityGroupId });
  }
}