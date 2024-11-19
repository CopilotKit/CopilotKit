import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ecr_assets from "aws-cdk-lib/aws-ecr-assets"; // Add this import
import * as path from "path";

export interface ECRImageStackProps extends cdk.StackProps {
  /**
   * Path to the directory of the demo to deploy, relative to the root of the repository.
   */
  demoDir: string;
  overrideDockerfile?: string;
  buildSecrets?: string[];
  overrideBuildProps?: Partial<cdk.aws_ecr_assets.DockerImageAssetProps>;
}

export class ECRImageStack extends cdk.Stack {
  image: ecr_assets.DockerImageAsset;

  constructor(scope: Construct, id: string, props: ECRImageStackProps) {
    super(scope, id + "ECRImage", props);

    let buildSecrets: Record<string, string> = {};

    if(props.buildSecrets) {
      for (const secret of props.buildSecrets) {
        buildSecrets[secret] = `id=${secret}`;
      }
    }

    const buildArgs: Record<string, string> = {
      APP_DIR: props.demoDir,
    };

    const image = new ecr_assets.DockerImageAsset(this, "Image", {
      directory: path.resolve(__dirname, "../../"),
      file: props.overrideDockerfile,
      platform: ecr_assets.Platform.LINUX_AMD64,
      buildArgs: {
        APP_DIR: props.demoDir,
      },
      buildSecrets,
      ...props.overrideBuildProps ?? {},
    });

    this.image = image;
  }
}
