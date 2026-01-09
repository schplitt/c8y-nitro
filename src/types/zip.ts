import type { C8YManifestOptions } from './manifest'

export interface C8YZipOptions {
  /**
   * Name of the generated zip file
   * @default '${packageName}-${version}.zip'
   */
  name?: string | ((packageName: string, version: string) => string)

  /**
   * Output directory for the generated zip file.\
   * Relative to the config file.
   * @default './'
   */
  outputDir?: string

  /**
   * Configuration of the "cumulocity.json" manifest file used for the zip.
   */
  manifest?: C8YManifestOptions
}
