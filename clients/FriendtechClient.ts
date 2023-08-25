export class FriendtechClient {
  private readonly apiUrl: string;

  constructor() {
    this.apiUrl = "https://prod-api.kosetto.com";
  }

  async getUserByAddress(address: string) {
    let triesCounter = 0;
    while (triesCounter < 3) {
      // flaky API, retry 3 times
      if (triesCounter > 0) console.log(`try #${triesCounter}`);

      try {
        const response = await fetch(`${this.apiUrl}/users/${address}`);

        return await response.json();
      } catch (err) {
        console.log(`getUserByAddress failed`, err);
      }
      triesCounter++;
    }
  }
}
