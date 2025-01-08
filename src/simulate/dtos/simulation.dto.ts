import { ArrayMinSize, IsEnum, IsInt, IsOptional, IsPositive, IsString } from 'class-validator'
import { Transform } from 'class-transformer'
import { PROTOCOL_ENUM } from 'utills/enums/protocol_enum'
import { SWAP_TYPE_ENUM } from 'utills/enums/swap_enum'

export class SimulationTxsDTO {

    @IsOptional()
    @IsString()
    @Transform(({ value }) => value.toLowerCase())
    walletAddr: string

    @IsOptional()
    @IsEnum(SWAP_TYPE_ENUM)
    swapType: SWAP_TYPE_ENUM = SWAP_TYPE_ENUM.ON_CHAIN

    @IsOptional()
    @IsEnum(PROTOCOL_ENUM)
    protocol: PROTOCOL_ENUM

    @IsOptional()
    @Transform(({ value }) => Number(value))
    @IsPositive()
    @IsInt()
    fromChainId: number

    @IsOptional()
    @Transform(({ value }) => Number(value))
    @IsPositive()
    @IsInt()
    toChainId: number

    @IsOptional()
    @Transform(({ value }) => value.toLowerCase().split(','))
    @ArrayMinSize(1)
    fromTokens: string

    @IsOptional()
    @Transform(({ value }) => value.toLowerCase().split(','))
    @ArrayMinSize(1)
    toTokens: string
}