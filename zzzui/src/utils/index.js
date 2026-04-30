let _uniqueId = 0
export const generateId = () => {
  return ++_uniqueId
}

export const isValidValue = (value) => {
  return value !== undefined && !Number.isNaN(value) && value !== null
}

export const prefixNumber = (n) => `${n}`[1] ? `${n}` : `0${n}`;