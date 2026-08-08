import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { InvitationsService } from './invitations.service';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';

// Publik dengan sengaja — calon anggota belum punya JWT saat membuka link undangan.
// Keamanan bertumpu pada token acak 32-byte yang hanya dikirim lewat email.
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get(':token')
  getByToken(@Param('token') token: string) {
    return this.invitations.getByToken(token);
  }

  @Post(':token/accept')
  accept(@Param('token') token: string, @Body() dto: AcceptInvitationDto) {
    return this.invitations.accept(token, dto.name, dto.password);
  }
}
