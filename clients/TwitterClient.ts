export class TwitterClient {
  private readonly apiUrl: string;

  constructor() {
    this.apiUrl = "https://api.twitter.com/1.1";
  }

  async getUser(userId: string) {
    const response = await fetch(
      `${this.apiUrl}/users/show.json?screen_name=${userId}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.TWITTER_BEARER_TOKEN}`,
        },
      }
    );
    return await response.json();
  }
}
