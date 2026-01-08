export interface C8YAPIClientOptions {
  /**
   * Relative directory from nitro configuration file to generate the API client into.
   */
  dir: string

  /**
   * The prefix of the microservice endpoints.
   * @example 'my-microservice' will result in the endpoints calling "https:<tenant>.com/service/my-microservice/..."
   */
  msBase: string

  /**
   * Name of the generated API client file (without extension).
   * @default 'c8y-api-client'
   */
  name?: string

}
