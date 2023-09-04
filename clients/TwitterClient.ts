export type UserResponse = {
  id: number;
  id_str: string;
  name: string;
  screen_name: string;
  location: string;
  profile_location: any;
  description: string;
  url: string;
  entities: unknown;
  protected: boolean;
  followers_count: number;
  friends_count: number;
  listed_count: number;
  created_at: string;
  [key: string]: any; // remaining fields we don't care about
};
export class TwitterClient {
  private readonly apiUrl: string;

  constructor() {
    this.apiUrl = "https://api.twitter.com/1.1";
  }

  async getUser(userId: string): Promise<UserResponse> {
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
