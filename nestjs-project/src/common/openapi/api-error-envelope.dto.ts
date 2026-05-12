import { ApiProperty } from '@nestjs/swagger';

export class ApiErrorEnvelope {
  @ApiProperty({ example: 401 })
  statusCode: number;

  @ApiProperty({ example: 'INVALID_CREDENTIALS' })
  error: string;

  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    example: 'Invalid email or password',
  })
  message: string | string[];

  @ApiProperty({ required: false, nullable: true, example: undefined })
  code?: string;
}
