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
    newImage.onload = () => {
      setIsLoaded(true)
    }
    newImage.src = URL.createObjectURL(file)
    setImage(newImage)

    return () => {
      newImage.onload = null
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
export function resizeImageFile(
  file: File,
  maxSize: number
): Promise<ResizeImageFileResult> {
  const reader = new FileReader()
  const image = new Image()
  const canvas = document.createElement('canvas')

  const resize = (): ResizeImageFileResult => {
    let { width, height } = image

    if (width > height) {
      if (width > maxSize) {
        height *= maxSize / width
        width = maxSize
      }
    } else if (height > maxSize) {
      width *= maxSize / height
      height = maxSize
    }

    if (width === image.width && height === image.height) {
      return { file, resized: false }
    }

    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('could not get context')
    }
    ctx.drawImage(image, 0, 0, width, height)
    const dataUrl = canvas.toDataURL('image/jpeg')
    const blob = dataURItoBlob(dataUrl)
    const f = new File([blob], file.name, {
      type: file.type,
    })
    return {
      file: f,
      resized: true,
      originalWidth: image.width,
      originalHeight: image.height,
    }
  }

  return new Promise((resolve, reject) => {
    if (!file.type.match(/image.*/)) {
      reject(new Error('Not an image'))
      return
    }
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Unable to read image data'))
        return
      }
      image.onload = () => resolve(resize())
      image.onerror = () => reject(new Error('Unable to decode image'))
      image.src = reader.result
    }
    reader.onerror = () =>
      reject(reader.error ?? new Error('Unable to read image'))
    reader.readAsDataURL(file)
  })
}
