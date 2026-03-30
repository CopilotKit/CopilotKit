import { RingLoader } from "react-spinners"

type GenerationProps = {
  message: string
}

const LoadingSpinner = ({ message }: GenerationProps) => {
  return (
    <div className="p-6 flex flex-col justify-center items-center h-full gap-8">
      <RingLoader size={200} color="white" />
      <div className="text-center">
        <p className="text-4xl font-medium animate-pulse mb-5">{message}</p>
        <p className="text-2xl text-slate-100 animate-bounce">Please stand by...</p>
      </div>
    </div>
  )
}

export default LoadingSpinner
