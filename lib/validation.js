const Joi = require('joi');

const loginSchema = Joi.object({
  username: Joi.string().min(3).required().messages({
    'string.min': 'Uživatelské jméno musí mít alespoň 3 znaky',
    'any.required': 'Uživatelské jméno je povinné'
  }),
  password: Joi.string().min(6).required().messages({
    'string.min': 'Heslo musí mít alespoň 6 znaků',
    'any.required': 'Heslo je povinné'
  })
});

module.exports = { loginSchema };
