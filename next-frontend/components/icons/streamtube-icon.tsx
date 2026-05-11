import * as React from "react"

import { cn } from "@/lib/utils"

function StreamTubeIcon({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={cn(className)}
      {...props}
    >
      <path
        d="M38.6476 10.2246C38.206 8.5617 36.9048 7.25205 35.2527 6.80761C32.2581 6 20.25 6 20.25 6C20.25 6 8.24205 6 5.24737 6.80761C3.59524 7.25213 2.29404 8.5617 1.85241 10.2246C1.05 13.2387 1.05 19.5273 1.05 19.5273C1.05 19.5273 1.05 25.8159 1.85241 28.83C2.29404 30.4929 3.59524 31.7479 5.24737 32.1924C8.24205 33 20.25 33 20.25 33C20.25 33 32.258 33 35.2527 32.1924C36.9048 31.7479 38.206 30.4929 38.6476 28.83C39.4501 25.8159 39.45 19.5273 39.45 19.5273C39.45 19.5273 39.4501 13.2387 38.6476 10.2246ZM16.3227 25.2369V13.8177L26.3591 19.5274L16.3227 25.2369Z"
        fill="currentColor"
      />
    </svg>
  )
}

export { StreamTubeIcon }
