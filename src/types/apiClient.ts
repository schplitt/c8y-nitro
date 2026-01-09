export interface C8YAPIClientOptions {
  /**
   * Relative directory from nitro configuration file to generate the API client into.
   */
  dir: string

  /**
   * Service context path for microservice endpoints.\
   * Defaults to contextPath from manifest (package.json name, with scope stripped).\
   * Override this if deploying with a different context path.
   * @example "my-microservice" results in "https://<tenant>.com/service/my-microservice/..."
   */
  contextPath?: string
}
