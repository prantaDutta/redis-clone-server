import { hash, verify } from 'argon2'
import {
  Arg,
  Ctx,
  Field,
  Mutation,
  ObjectType,
  Query,
  Resolver
} from 'type-graphql'
import { v4 } from 'uuid'
import { COOKIE_NAME, FORGET_PASSWORD_PREFIX } from '../constants'
import { User } from '../entities/User'
import { MyContext } from '../types'
import { sendEmail } from '../util/sendEmail'
import { validateRegister } from '../util/validateRegister'
import { UsernamePasswordInput } from './UsernamePasswordInput'

@ObjectType()
class FieldError {
  @Field()
  field: string

  @Field()
  message: string
}

@ObjectType()
class UserResponse {
  @Field(() => [FieldError], { nullable: true })
  errors?: FieldError[]

  @Field(() => User, { nullable: true })
  user?: User
}

@Resolver()
export class UserResolver {
  @Mutation(() => UserResponse)
  async changePassword(
    @Arg('token') token: string,
    @Arg('newPassword') newPassword: string,
    @Ctx() { redis, em, req }: MyContext
  ): Promise<UserResponse> {
    if (newPassword.length < 3) {
      return {
        errors: [
          {
            field: 'newPassword',
            message: 'length must be greater than 3'
          }
        ]
      }
    }

    const key = FORGET_PASSWORD_PREFIX + token

    const userId = await redis.get(key)
    if (!userId) {
      return {
        errors: [
          {
            field: 'token',
            message: 'token expired'
          }
        ]
      }
    }

    const user = await em.findOne(User, { id: parseInt(userId!) })

    if (!user) {
      return {
        errors: [
          {
            field: 'token',
            message: 'user no longer exists'
          }
        ]
      }
    }

    user.password = await hash(newPassword)
    await em.persistAndFlush(user)

    await redis.del(key)

    // log in user after changing password
    req.session.userId = user.id

    return { user }
  }

  @Mutation(() => Boolean)
  async forgotPassword(
    @Arg('email') email: string,
    @Ctx() { em, redis }: MyContext
  ) {
    const user = await em.findOne(User, { email })
    if (!user) {
      return true
    }

    const token = v4()

    await redis.set(
      FORGET_PASSWORD_PREFIX + token,
      user.id,
      'ex',
      1000 * 60 * 60 * 24 * 3 // 3 days
    )

    await sendEmail(
      email,
      `<a href="http://localhost:3000/change-password/${token}">reset password</a>`
    )

    return true
  }

  @Query(() => User, { nullable: true })
  async me(@Ctx() { req, em }: MyContext): Promise<User | null> {
    // you are not logged in
    if (!req.session.userId) {
      return Promise.resolve(null)
    }

    const user = await em.findOne(User, { id: req.session.userId })
    return user
  }

  @Mutation(() => UserResponse)
  async register(
    @Arg('options') options: UsernamePasswordInput,
    @Ctx() { em, req }: MyContext
  ): Promise<UserResponse> {
    const errors = validateRegister(options)
    if (errors) {
      return { errors }
    }
    const hashedPassword = await hash(options.password)

    const valid = await em.findOne(User, { username: options.username })
    if (valid) {
      return {
        errors: [
          {
            field: 'username',
            message: 'username already taken'
          }
        ]
      }
    }
    const user = em.create(User, {
      username: options.username,
      password: hashedPassword,
      email: options.email
    })
    try {
      // const [user] = await (em as EntityManager)
      //   .createQueryBuilder(User)
      //   .getKnexQuery()
      //   .insert({
      //     username: options.username,
      //     password: hashedPassword,
      //     created_at: new Date(),
      //     email: options.email,
      //     updated_at: new Date()
      //   })
      //   .returning('*')
      await em.persistAndFlush(user)
    } catch (err) {
      console.log('message: ', err.message)
      return {
        errors: [
          {
            field: 'username',
            message: 'something went wrong'
          }
        ]
      }
    }
    req.session.userId = user.id
    return { user }
  }

  @Mutation(() => UserResponse)
  async login(
    @Arg('usernameOrEmail') usernameOrEmail: string,
    @Arg('password') password: string,
    @Ctx() { em, req }: MyContext
  ): Promise<UserResponse> {
    const user = await em.findOne(
      User,
      usernameOrEmail.includes('@')
        ? { email: usernameOrEmail }
        : { username: usernameOrEmail }
    )
    if (!user) {
      return {
        errors: [
          {
            field: 'usernameOrEmail',
            message: 'that username doesn"t exist'
          }
        ]
      }
    }
    const valid = await verify(user.password, password)
    if (!valid) {
      return {
        errors: [
          {
            field: 'password',
            message: 'Incorrect Password'
          }
        ]
      }
    }

    req.session.userId = user.id

    return { user }
  }

  @Mutation(() => Boolean)
  logout(@Ctx() { req, res }: MyContext) {
    return new Promise((resolve) =>
      req.session.destroy((err) => {
        res.clearCookie(COOKIE_NAME)
        if (err) {
          console.log(err)
          resolve(false)
          return
        }
        resolve(true)
      })
    )
  }
}
