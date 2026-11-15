import convict from 'convict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import convictFormatWithValidator from 'convict-format-with-validator'

const dirname = path.dirname(fileURLToPath(import.meta.url))

const fourHoursMs = 14400000
const oneWeekMs = 604800000

const linkable = ['http:', 'https:']

const isProduction = process.env.NODE_ENV === 'production'
const isTest = process.env.NODE_ENV === 'test'
const isDevelopment = process.env.NODE_ENV === 'development'

convict.addFormats(convictFormatWithValidator)

interface ConfigSchema {
  serviceVersion: string | null
  host: string
  port: number
  staticCacheTimeout: number
  serviceName: string
  environmentLabel:
    | 'local'
    | 'infra-dev'
    | 'infra-test'
    | 'management'
    | 'dev'
    | 'test'
    | 'perf-test'
    | 'ext-test'
    | 'prod'
  root: string
  assetPath: string
  isProduction: boolean
  isDevelopment: boolean
  isTest: boolean
  log: {
    enabled: boolean
    level: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent'
    format: 'ecs' | 'pino-pretty'
    redact: string[]
  }
  httpProxy: string | null
  isSecureContextEnabled: boolean
  session: {
    cache: {
      engine: 'redis' | 'memory'
      name: string
      ttl: number
    }
    cookie: {
      ttl: number
      password: string
      secure: boolean
    }
  }
  auth: {
    discoveryUri: string
    clientId: string
    appBaseUrl: string
    cookie: {
      password: string
    }
    federatedCredentials: {
      audience: string
    }
  }
  redis: {
    host: string
    port: number
    username: string
    password: string
    keyPrefix: string
    useSingleInstanceCache: boolean
    useTLS: boolean
  }
  nunjucks: {
    watch: boolean
    noCache: boolean
  }
  tracing: {
    header: string
  }
  gas: {
    apiUrl: string
    serviceToken: string
    timeoutMs: number
  }
  logs: {
    explorerBaseUrl: string
  }
}

export const config = convict<ConfigSchema>({
  serviceVersion: {
    doc: 'The service version, this variable is injected into your docker container in CDP environments',
    format: String,
    nullable: true,
    default: null,
    env: 'SERVICE_VERSION'
  },
  host: {
    doc: 'The IP address to bind',
    format: 'ipaddress',
    default: '0.0.0.0',
    env: 'HOST'
  },
  port: {
    doc: 'The port to bind.',
    format: 'port',
    default: 3000,
    env: 'PORT'
  },
  staticCacheTimeout: {
    doc: 'Static cache timeout in milliseconds',
    format: Number,
    default: oneWeekMs,
    env: 'STATIC_CACHE_TIMEOUT'
  },
  serviceName: {
    doc: 'Applications Service Name',
    format: String,
    default: 'fg-grants-platform-admin'
  },
  // Shown in the navbar, so an operator can tell which environment a redrive would write to.
  environmentLabel: {
    doc: 'The CDP environment this deployment runs in. Every service container is given it; `local` is where nothing does.',
    format: [
      'local',
      'infra-dev',
      'infra-test',
      'management',
      'dev',
      'test',
      'perf-test',
      'ext-test',
      'prod'
    ],
    default: 'local',
    env: 'ENVIRONMENT'
  },
  root: {
    doc: 'Project root',
    format: String,
    default: path.resolve(dirname, '../..')
  },
  assetPath: {
    doc: 'Asset path',
    format: String,
    default: '/public',
    env: 'ASSET_PATH'
  },
  isProduction: {
    doc: 'If this application running in the production environment',
    format: Boolean,
    default: isProduction
  },
  isDevelopment: {
    doc: 'If this application running in the development environment',
    format: Boolean,
    default: isDevelopment
  },
  isTest: {
    doc: 'If this application running in the test environment',
    format: Boolean,
    default: isTest
  },
  log: {
    enabled: {
      doc: 'Is logging enabled',
      format: Boolean,
      default: process.env.NODE_ENV !== 'test',
      env: 'LOG_ENABLED'
    },
    level: {
      doc: 'Logging level',
      format: ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'],
      default: 'info',
      env: 'LOG_LEVEL'
    },
    format: {
      doc: 'Format to output logs in.',
      format: ['ecs', 'pino-pretty'],
      default: isProduction ? 'ecs' : 'pino-pretty',
      env: 'LOG_FORMAT'
    },
    redact: {
      doc: 'Log paths to redact',
      format: Array,
      default: isProduction
        ? ['req.headers.authorization', 'req.headers.cookie', 'res.headers']
        : [],
      env: 'LOG_REDACT'
    }
  },
  httpProxy: {
    doc: 'HTTP Proxy',
    format: String,
    nullable: true,
    default: null,
    env: 'HTTP_PROXY'
  },
  isSecureContextEnabled: {
    doc: 'Enable Secure Context',
    format: Boolean,
    default: isProduction,
    env: 'ENABLE_SECURE_CONTEXT'
  },
  session: {
    cache: {
      engine: {
        doc: 'backend cache is written to',
        format: ['redis', 'memory'],
        default: isProduction ? 'redis' : 'memory',
        env: 'SESSION_CACHE_ENGINE'
      },
      name: {
        doc: 'server side session cache name',
        format: String,
        default: 'session',
        env: 'SESSION_CACHE_NAME'
      },
      ttl: {
        doc: 'server side session cache ttl',
        format: Number,
        default: fourHoursMs,
        env: 'SESSION_CACHE_TTL'
      }
    },
    cookie: {
      ttl: {
        doc: 'Session cookie ttl',
        format: Number,
        default: fourHoursMs,
        env: 'SESSION_COOKIE_TTL'
      },
      password: {
        doc: 'session cookie password',
        format: String,
        default: 'the-password-must-be-at-least-32-characters-long',
        env: 'SESSION_COOKIE_PASSWORD',
        sensitive: true
      },
      secure: {
        doc: 'set secure flag on cookie',
        format: Boolean,
        default: isProduction,
        env: 'SESSION_COOKIE_SECURE'
      }
    }
  },
  auth: {
    discoveryUri: {
      doc: 'OIDC discovery document of the identity provider. Defaults to the shared Entra stub that fg-cw-backend runs on port 3010. Deployed environments point this at Entra ID, as https://login.microsoftonline.com/<tenant-id>/v2.0/.well-known/openid-configuration',
      format: String,
      default: 'http://localhost:3010/.well-known/openid-configuration',
      env: 'OIDC_DISCOVERY_URI'
    },
    clientId: {
      doc: 'Application (client) id, as registered with the identity provider',
      format: String,
      default: 'client1',
      env: 'OIDC_CLIENT_ID'
    },
    appBaseUrl: {
      doc: 'Externally reachable base url of this app, used to build the OIDC redirect uri',
      format: String,
      default: 'http://localhost:3000',
      env: 'APP_BASE_URL'
    },
    cookie: {
      password: {
        doc: 'password used to encrypt the transient OIDC login cookie',
        format: String,
        default: 'the-password-must-be-at-least-32-characters-long',
        env: 'AUTH_COOKIE_PASSWORD',
        sensitive: true
      }
    },
    federatedCredentials: {
      audience: {
        doc: 'Audience configured on the Entra ID federated credential, and requested of AWS STS',
        format: String,
        default: 'fg-grants-platform-admin',
        env: 'FEDERATED_CREDENTIALS_AUDIENCE'
      }
    }
  },
  redis: {
    host: {
      doc: 'Redis cache host',
      format: String,
      default: '127.0.0.1',
      env: 'REDIS_HOST'
    },
    port: {
      doc: 'Redis cache port',
      format: 'port',
      default: 6379,
      env: 'REDIS_PORT'
    },
    username: {
      doc: 'Redis cache username',
      format: String,
      default: '',
      env: 'REDIS_USERNAME'
    },
    password: {
      doc: 'Redis cache password',
      format: '*',
      default: '',
      sensitive: true,
      env: 'REDIS_PASSWORD'
    },
    keyPrefix: {
      doc: 'Redis cache key prefix name used to isolate the cached results across multiple clients',
      format: String,
      default: 'fg-grants-platform-admin:',
      env: 'REDIS_KEY_PREFIX'
    },
    useSingleInstanceCache: {
      doc: 'Connect to a single instance of redis instead of a cluster.',
      format: Boolean,
      default: !isProduction,
      env: 'USE_SINGLE_INSTANCE_CACHE'
    },
    useTLS: {
      doc: 'Connect to redis using TLS',
      format: Boolean,
      default: isProduction,
      env: 'REDIS_TLS'
    }
  },
  nunjucks: {
    watch: {
      doc: 'Reload templates when they are changed.',
      format: Boolean,
      default: isDevelopment
    },
    noCache: {
      doc: 'Recompile templates on every render instead of when they change.',
      format: Boolean,
      default: false,
      env: 'NUNJUCKS_NO_CACHE'
    }
  },
  tracing: {
    header: {
      doc: 'Which header to track',
      format: String,
      default: 'x-cdp-request-id',
      env: 'TRACING_HEADER'
    }
  },
  gas: {
    apiUrl: {
      doc: 'Base url of fg-gas-backend, which serves the /grant-admin endpoints',
      format: String,
      default: 'http://localhost:3102',
      env: 'GAS_API_URL'
    },
    serviceToken: {
      doc: 'Bearer token presented to fg-gas-backend',
      format: String,
      default: '',
      sensitive: true,
      env: 'GAS_SERVICE_TOKEN'
    },
    // Above GAS's own 5s Mongo maxTimeMS, so a slow answer arrives rather than timing out here.
    timeoutMs: {
      doc: 'How long to wait for fg-gas-backend before giving up, in milliseconds',
      format: 'nat',
      default: 7000,
      env: 'GAS_API_TIMEOUT_MS'
    }
  },
  logs: {
    explorerBaseUrl: {
      doc: 'Base url of the CDP OpenSearch dashboards, which the event page links a Trace ID into',
      // Spelled out in the message: the convict path is not what anyone sets.
      // The scheme is checked because the value is concatenated into an href.
      format: (value: unknown) => {
        const url = typeof value === 'string' ? URL.parse(value) : null

        if (url === null || !linkable.includes(url.protocol)) {
          throw new Error(
            'LOGS_EXPLORER_BASE_URL must be an http or https url, e.g. https://logs.dev.cdp-int.defra.cloud'
          )
        }
      },
      default: null,
      env: 'LOGS_EXPLORER_BASE_URL'
    }
  }
})

config.validate({ allowed: 'strict' })
