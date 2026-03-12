import { client } from "../Client/client";


export async function getPRDataService() {
    try {
        let config = {
            method: "POST",
            url: "/api/getPRdata"
        }
        const res = await client(config)
        return res
    } catch (error) {
        throw error
    }
}
