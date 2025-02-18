import chalk from 'chalk';
import semver from 'semver';
import set from 'lodash/set';
import inquirer from 'inquirer';
import unset from 'lodash/unset';
import { Config, Versions } from '@expo/xdl';
import * as jsondiffpatch from 'jsondiffpatch';
import { Command } from '@expo/commander/typings';

type ActionOptions = {
  sdkVersion: string;
  deprecated?: boolean;
  releaseNoteUrl?: string;
  key?: string;
  value?: any;
  delete?: boolean;
  production: boolean;
}

const STAGING_HOST = 'staging.expo.io';

async function chooseSdkVersionAsync(sdkVersions: string[]): Promise<string> {
  const { sdkVersion } = await inquirer.prompt<{ sdkVersion: string }>([
    {
      type: 'list',
      name: 'sdkVersion',
      default: sdkVersions[0],
      choices: sdkVersions,
    },
  ]);
  return sdkVersion;
}

function setSdkVersionConfig(sdkVersionConfig: object, key: string, value: any): void {
  if (value === undefined) {
    console.log(`Deleting ${chalk.yellow(key)} config key ...`);
    unset(sdkVersionConfig, key);
  } else {
    console.log(`Changing ${chalk.yellow(key)} config key ...`);
    set(sdkVersionConfig, key, value);
  }
}

async function action(options: ActionOptions) {
  Config.api.host = STAGING_HOST;
  const versions = await Versions.versionsAsync();
  const sdkVersions = Object.keys(versions.sdkVersions).sort(semver.rcompare);
  const sdkVersion = options.sdkVersion || await chooseSdkVersionAsync(sdkVersions);
  const containsSdk = sdkVersions.includes(sdkVersion);

  if (!semver.valid(sdkVersion)) {
    console.error(chalk.red(`Provided SDK version ${chalk.cyan(sdkVersion)} is invalid.`));
    return;
  }
  if (!containsSdk) {
    const { addNewSdk } = await inquirer.prompt<{ addNewSdk: boolean }>([
      {
        type: 'confirm',
        name: 'addNewSdk',
        message: `Configuration for SDK ${chalk.cyan(sdkVersion)} doesn't exist. Do you want to initialize it?`,
        default: true,
      },
    ]);
    if (!addNewSdk) {
      console.log(chalk.yellow('Canceled'));
      return;
    }
  }

  const sdkVersionConfig = containsSdk ? { ...versions.sdkVersions[sdkVersion] } : {};

  console.log(`\nUsing ${chalk.blue(STAGING_HOST)} host ...`);
  console.log(`Using SDK ${chalk.cyan(sdkVersion)} ...`);

  if ('deprecated' in options) {
    setSdkVersionConfig(sdkVersionConfig, 'isDeprecated', !!options.deprecated);
  }
  if ('releaseNoteUrl' in options && typeof options.releaseNoteUrl === 'string') {
    setSdkVersionConfig(sdkVersionConfig, 'releaseNoteUrl', options.releaseNoteUrl);
  }
  if (options.key) {
    if (!('value' in options) && !options.delete) {
      console.log(chalk.red('`--key` flag requires `--value` or `--delete` flag.'));
      return;
    }
    setSdkVersionConfig(sdkVersionConfig, options.key, options.delete ? undefined : options.value);
  }

  const newVersions = {
    ...versions,
    sdkVersions: {
      ...versions.sdkVersions,
      [sdkVersion]: sdkVersionConfig,
    },
  };

  const delta = jsondiffpatch.diff(versions.sdkVersions[sdkVersion], sdkVersionConfig);

  if (!delta) {
    console.log(chalk.yellow('There are no changes to apply in the configuration.'));
    return;
  }

  console.log(`\nHere is the diff of changes to apply on SDK ${chalk.cyan(sdkVersion)} version config:`);
  console.log(
    jsondiffpatch.formatters.console.format(delta!, versions.sdkVersions[sdkVersion]),
  );

  const { isCorrect } = await inquirer.prompt<{ isCorrect: boolean }>([
    {
      type: 'confirm',
      name: 'isCorrect',
      message: `Does this look correct? Type \`y\` or press enter to update ${chalk.green('staging')} config.`,
      default: true,
    },
  ]);

  if (isCorrect) {
    // Save new configuration.
    try {
      await Versions.setVersionsAsync(newVersions);
    } catch (error) {
      console.error(error);
    }

    console.log(
      chalk.green('\nSuccessfully updated staging config. You can check it out on'),
      chalk.blue(`https://${STAGING_HOST}/--/api/v2/versions`),
    );
  } else {
    console.log(chalk.yellow('Canceled'));
  }
}

export default (program: Command) => {
  program
    .command('update-versions-endpoint')
    .alias('update-versions')
    .description(`Updates SDK configuration under ${chalk.blue('https://staging.expo.io/--/api/v2/versions')}`)
    .option('-s, --sdkVersion [string]', 'SDK version to update. Can be chosen from the list if not provided.')
    .option('-d, --deprecated [boolean]', 'Sets chosen SDK version as deprecated.')
    .option('-r, --release-note-url [string]', 'URL pointing to the release blog post.')
    .option('-k, --key [string]', 'A custom, dotted key that you want to set in the configuration.')
    .option('-v, --value [any]', 'Value for the custom key to be set in the configuration.')
    .option('--delete', 'Deletes config entry under key specified by `--key` flag.')
    .asyncAction(action);
}
