import { Connection, EntityManager, IDatabaseDriver } from '@mikro-orm/core'
import { Request, Response } from 'express'
import { Session } from 'express-session'
import { Redis } from 'ioredis'

export type MyContext = {
  em: EntityManager<IDatabaseDriver<Connection>>
  req: Request & {
    session: Session & {
      [key: string]: any
    }
  }
  res: Response
  redis: Redis
}
