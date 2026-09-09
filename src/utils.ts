import { type RefObject, useCallback, useEffect, useRef, useState } from 'react'

export function useClickAway<T extends HTMLElement>(
  ref: RefObject<T>,
  callback: () => void
) {
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const element = ref.current
      if (element && !element.contains(event.target as Node)) {
        callbackRef.current()
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
    }
  }, [ref])
}

export function useWindowSize() {
  const [size, setSize] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }))

  useEffect(() => {
    const handleResize = () => {
      setSize({ width: window.innerWidth, height: window.innerHeight })
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return size
}

export function dataURItoBlob(dataURI: string) {
  const mime = dataURI.split(',')[0].split(':')[1].split(';')[0]
  const binary = atob(dataURI.split(',')[1])
  const array = []
  for (let i = 0; i < binary.length; i += 1) {
    array.push(binary.charCodeAt(i))
  }
  return new Blob([new Uint8Array(array)], { type: mime })
}

// const dataURItoBlob = (dataURI: string) => {
//   const bytes =
//     dataURI.split(',')[0].indexOf('base64') >= 0
//       ? atob(dataURI.split(',')[1])
//       : unescape(dataURI.split(',')[1])
//   const mime = dataURI.split(',')[0].split(':')[1].split(';')[0]
//   const max = bytes.length
//   const ia = new Uint8Array(max)
//   for (var i = 0; i < max; i++) ia[i] = bytes.charCodeAt(i)
//   return new Blob([ia], { type: mime })
// }

export function downloadImage(uri: string, name: string) {
  const link = document.createElement('a')
  link.href = uri
  link.download = name

  // this is necessary as link.click() does not work on the latest firefox
  link.dispatchEvent(
    new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: window,
    })
  )

  setTimeout(() => {
    // For Firefox it is necessary to delay revoking the ObjectURL
    // window.URL.revokeObjectURL(base64)
    link.remove()
  }, 100)
}

export function loadImage(image: HTMLImageElement, src: string) {
  return new Promise((resolve, reject) => {
    const initSRC = image.src
    const img = image
    img.onload = resolve
    img.onerror = err => {
      img.src = initSRC
      reject(err)
    }
    img.src = src
  })
}

export function useImage(
  file: Blob | MediaSource
): [HTMLImageElement, boolean, (width: number, height: number) => void] {
  const [image, setImage] = useState(new Image())
  const [isLoaded, setIsLoaded] = useState(false)

  // 调整图像分辨率的函数
  const adjustResolution = useCallback(
    (width, height) => {
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d')
      if (!context) {
        throw new Error('Unable to get canvas context')
      }
      canvas.width = width
      canvas.height = height
      context.drawImage(image, 0, 0, width, height)
      const resizedImage = new Image()
      resizedImage.src = canvas.toDataURL()
      setImage(resizedImage)
    },
    [image]
  )

  useEffect(() => {
    const newImage = new Image()
    const objectUrl = URL.createObjectURL(file)
    setIsLoaded(false)
    newImage.onload = () => {
      setIsLoaded(true)
    }
    newImage.src = objectUrl
    setImage(newImage)

    return () => {
      newImage.onload = null
      newImage.onerror = null
      URL.revokeObjectURL(objectUrl)
    }
  }, [file])

  return [image, isLoaded, adjustResolution]
}

// https://stackoverflow.com/questions/23945494/use-html5-to-resize-an-image-before-upload
interface ResizeImageFileResult {
  file: File
  resized: boolean
  originalWidth?: number
  originalHeight?: number
}
export async function resizeImageFile(
  file: File,
  maxSize: number
): Promise<ResizeImageFileResult> {
  if (!Number.isFinite(maxSize) || maxSize < 1) {
    throw new Error('Invalid maximum image size')
  }
  if (!file.type.startsWith('image/')) {
    throw new Error('Not an image')
  }
  const image = new Image()
  const objectUrl = URL.createObjectURL(file)
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Unable to decode image'))
      image.src = objectUrl
    })
    const { naturalWidth: width, naturalHeight: height } = image
    if (!width || !height) throw new Error('Image has invalid dimensions')
    const scale = Math.min(1, maxSize / Math.max(width, height))
    if (scale === 1) {
      return { file, resized: false }
    }

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('could not get context')
    }
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    const outputType =
      file.type === 'image/png' || file.type === 'image/webp'
        ? file.type
        : 'image/jpeg'
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(result => {
        if (result) resolve(result)
        else reject(new Error('Unable to encode image'))
      }, outputType)
    })
    const f = new File([blob], file.name, {
      type: blob.type,
    })
    return {
      file: f,
      resized: true,
      originalWidth: width,
      originalHeight: height,
    }
  } finally {
    image.onload = null
    image.onerror = null
    URL.revokeObjectURL(objectUrl)
  }
}
