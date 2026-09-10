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
   * ZIP DEFLATE compression level used for `image.tar` and `cumulocity.json`.
   * Valid values are 1 (faster, larger) to 9 (slower, smaller).
   * @default 6
   */
  compressionLevel?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

  /**
   * Configuration of the "cumulocity.json" manifest file used for the zip.
   */
  manifest?: C8YManifestOptions
}
