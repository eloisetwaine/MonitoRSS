import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { Types } from "mongoose";
import { FeedConnectionType } from "../feeds/constants";
import { UserFeedsController } from "./user-feeds.controller";

describe("UserFeedsController", () => {
  let controller: UserFeedsController;
  const userFeedsService = {
    addFeed: jest.fn(),
    updateFeedById: jest.fn(),
  };

  beforeEach(async () => {
    controller = new UserFeedsController(userFeedsService as never);
  });

  describe("createFeed", () => {
    it("returns the created feed", async () => {
      const createdFeed = {
        title: "title",
        url: "url",
        _id: new Types.ObjectId(),
      };
      userFeedsService.addFeed.mockResolvedValue(createdFeed as never);

      const result = await controller.createFeed(
        {
          title: createdFeed.title,
          url: createdFeed.url,
        },
        {
          discord: {
            id: "discord id",
          },
        } as never
      );

      expect(result).toMatchObject({
        result: {
          title: createdFeed.title,
          url: createdFeed.url,
          id: createdFeed._id.toHexString(),
        },
      });
    });
  });

  describe("getFeed", () => {
    it("returns the feed", async () => {
      const discordUserId = "discord id";
      const feed = {
        title: "title",
        url: "url",
        _id: new Types.ObjectId(),
        user: {
          discordUserId,
        },
        connections: {
          discordChannels: [
            {
              id: new Types.ObjectId(),
              name: "discord channel con name",
              filters: {
                expression: {
                  foo: "discord channel filters",
                },
              },
              details: {
                hello: "discord channel details",
              },
            },
          ],
          discordWebhooks: [
            {
              id: new Types.ObjectId(),
              name: "discord webhook con name",
              filters: {
                expression: {
                  foo: "discord webhook filters",
                },
              },
              details: {
                hello: "discord webhook details",
              },
            },
          ],
        },
      };

      const result = await controller.getFeed(
        {
          discord: {
            id: discordUserId,
          },
        } as never,
        feed as never
      );

      expect(result).toMatchObject({
        result: {
          id: feed._id.toHexString(),
          title: feed.title,
          url: feed.url,
          connections: {
            discordChannels: feed.connections.discordChannels.map((con) => ({
              id: con.id.toHexString(),
              name: con.name,
              key: FeedConnectionType.DiscordChannel,
              details: con.details,
              filters: con.filters,
            })),
            discordWebhooks: feed.connections.discordWebhooks.map((con) => ({
              id: con.id.toHexString(),
              name: con.name,
              key: FeedConnectionType.DiscordWebhook,
              details: con.details,
              filters: con.filters,
            })),
          },
        },
      });
    });

    it("throws a forbidden exception if the feed does not belong to the user", async () => {
      const discordUserId = "discord id";
      const feed = {
        title: "title",
        url: "url",
        _id: new Types.ObjectId(),
        user: {
          discordUserId: "other discord id",
        },
        connections: {
          discordChannels: [],
          discordWebhooks: [],
        },
      };

      await expect(
        controller.getFeed(
          {
            discord: {
              id: discordUserId,
            },
          } as never,
          feed as never
        )
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("updateFeed", () => {
    it("throws forbidden exception if discord user id does not match feed", async () => {
      const feed = {
        user: {
          discordUserId: "discord user id",
        },
      } as never;

      await expect(
        controller.updateFeed(
          {
            discord: {
              id: "other discord user id",
            },
          } as never,
          feed,
          {
            title: "title",
            url: "url",
          }
        )
      ).rejects.toThrow(ForbiddenException);
    });
    it("returns the updated feed", async () => {
      const accessTokenInfo = {
        discord: {
          id: "discord-user-id",
        },
      };

      const feed = {
        title: "title",
        url: "url",
        _id: new Types.ObjectId(),
        user: {
          discordUserId: accessTokenInfo.discord.id,
        },
      };

      const updateBody = {
        title: "updated title",
      };

      jest
        .spyOn(userFeedsService, "updateFeedById")
        .mockResolvedValue(feed as never);

      const result = await controller.updateFeed(
        accessTokenInfo as never,
        feed as never,
        updateBody
      );

      expect(result).toMatchObject({
        result: {
          title: feed.title,
          url: feed.url,
          id: feed._id.toHexString(),
        },
      });
    });
  });
});
