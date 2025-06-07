import axios, { AxiosRequestConfig } from "axios";

export const client = async (config: AxiosRequestConfig) => {
    try {
        const res = await axios(config)
        return res.data
    } catch (error) {
        throw error
    }
}