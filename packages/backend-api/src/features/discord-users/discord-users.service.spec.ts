import { DiscordUsersService } from './discord-users.service';

describe('DiscordUsersService', () => {
  let service: DiscordUsersService;
  const discordApiService = {
    executeBearerRequest: jest.fn(),
  };
  const supportersService = {
    getBenefitsOfServers: jest.fn(),
    getBenefitsOfDiscordUser: jest.fn(),
  };

  beforeEach(async () => {
    service = new DiscordUsersService(
      discordApiService as never,
      supportersService as never,
    );

    jest.spyOn(discordApiService, 'executeBearerRequest').mockResolvedValue([]);
    jest.spyOn(supportersService, 'getBenefitsOfServers').mockResolvedValue([]);
    jest
      .spyOn(supportersService, 'getBenefitsOfDiscordUser')
      .mockResolvedValue({
        maxFeeds: 0,
        maxGuilds: 0,
        guilds: [],
      });
  });

  describe('getGuilds', () => {
    it('calls the correct api endpoint', async () => {
      const accessToken = 'abc';
      await service.getGuilds(accessToken);

      expect(discordApiService.executeBearerRequest).toHaveBeenCalledWith(
        accessToken,
        '/users/@me/guilds',
      );
    });

    it('returns the icon urls', async () => {
      const accessToken = 'abc';
      const guilds = [
        {
          id: 'guild_id',
          name: 'test',
          icon: 'icon_hash',
          owner: true,
          permissions: '123',
          features: ['123'],
        },
      ];
      discordApiService.executeBearerRequest.mockResolvedValue(guilds);

      supportersService.getBenefitsOfServers.mockResolvedValue([
        {
          maxFeeds: 10,
          webhooks: true,
        },
      ]);

      const result = await service.getGuilds(accessToken);

      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ...guilds[0],
            iconUrl:
              `https://cdn.discordapp.com/icons` +
              `/${guilds[0].id}/${guilds[0].icon}.png?size=128`,
          }),
        ]),
      );
    });

    it('returns the benefits correctly', async () => {
      const accessToken = 'abc';
      const guilds = [
        {
          id: 'guild_id',
          name: 'test',
          icon: 'icon_hash',
          owner: true,
          permissions: '123',
          features: ['123'],
        },
        {
          id: 'guild_id_2',
          name: 'test',
          icon: 'icon_hash',
          owner: true,
          permissions: '123',
          features: ['123'],
        },
      ];
      discordApiService.executeBearerRequest.mockResolvedValue(guilds);

      const benefitsResponse = [
        {
          maxFeeds: 10,
          webhooks: true,
        },
        {
          maxFeeds: 20,
          webhooks: true,
        },
      ];
      supportersService.getBenefitsOfServers.mockResolvedValue(
        benefitsResponse,
      );

      const result = await service.getGuilds(accessToken);

      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            benefits: {
              maxFeeds: benefitsResponse[0].maxFeeds,
              webhooks: benefitsResponse[0].webhooks,
            },
          }),
          expect.objectContaining({
            ...guilds[1],
            benefits: {
              maxFeeds: benefitsResponse[1].maxFeeds,
              webhooks: benefitsResponse[1].webhooks,
            },
          }),
        ]),
      );
    });

    it('excludes guilds with no permissions', async () => {
      const accessToken = 'abc';
      const guilds = [
        {
          id: 'guild_id',
          name: 'test',
          icon: 'icon_hash',
          owner: false,
          permissions: 0,
        },
      ];
      discordApiService.executeBearerRequest.mockResolvedValue(guilds);
      supportersService.getBenefitsOfServers.mockResolvedValue([
        {
          maxFeeds: 10,
          webhooks: true,
        },
      ]);
      const result = await service.getGuilds(accessToken);

      expect(result).toEqual([]);
    });

    it('includes guilds with manage channel permissions', async () => {
      const accessToken = 'abc';
      const guilds = [
        {
          id: 'guild_id',
          name: 'test',
          icon: 'icon_hash',
          owner: false,
          permissions: 16,
        },
      ];
      discordApiService.executeBearerRequest.mockResolvedValue(guilds);
      supportersService.getBenefitsOfServers.mockResolvedValue([
        {
          maxFeeds: 10,
          webhooks: true,
        },
      ]);
      const result = await service.getGuilds(accessToken);

      expect(result).toHaveLength(1);
    });
  });

  describe('getUser', () => {
    it('calls the correct api endpoint', async () => {
      const accessToken = 'abc';
      await service.getUser(accessToken);

      expect(discordApiService.executeBearerRequest).toHaveBeenCalledWith(
        accessToken,
        '/users/@me',
      );
    });

    it('returns the user', async () => {
      const accessToken = 'abc';
      const user = {
        id: 'user_id',
        username: 'test',
        avatar: 'icon_hash',
      };
      const supporterBenefits = {
        guilds: ['1'],
        maxFeeds: 10,
        maxGuilds: 10,
        expireAt: new Date(),
      };
      discordApiService.executeBearerRequest.mockResolvedValue(user);
      supportersService.getBenefitsOfDiscordUser.mockResolvedValue(
        supporterBenefits,
      );

      const result = await service.getUser(accessToken);

      expect(result).toEqual({
        id: user.id,
        username: user.username,
        avatar: user.avatar,
        avatarUrl: `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`,
        supporter: {
          guilds: supporterBenefits.guilds,
          maxFeeds: supporterBenefits.maxFeeds,
          maxGuilds: supporterBenefits.maxGuilds,
          expireAt: supporterBenefits.expireAt,
        },
      });
    });
  });
});
